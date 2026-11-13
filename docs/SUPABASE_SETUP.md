# Shared inventory (Supabase) — setup & operations

**Project:** `xrkbhopqyxoahusaozkc` (Seoul, ap-northeast-2) · **App:** https://sbsopex.github.io/container-stock-tracker/

## One-time setup (done 2026-11-13)
1. SQL Editor → ran `supabase/migrations/001_init.sql` + `002_roles_admin.sql` ✅
2. Auth → URL Configuration → Site URL = the GitHub Pages URL ✅
3. `.env.production` (committed) holds the project URL + **publishable** key (`sb_publishable_…`). It's public by design — RLS does the protecting. Never commit the `sb_secret_…` key.
4. Push to `main` → the workflow builds and deploys. The app switches from local-only to shared mode.

## Bootstrap the first admin (once)
Open the app → **Request access** with your email → confirm the email → then in SQL Editor:
```sql
insert into public.authorized_users (user_id, role)
select id, 'admin' from auth.users where email = 'YOUR_EMAIL'
on conflict (user_id) do update set role = 'admin';
```
After that, everything is in-app: **Settings → Users**.

## Roles
| Role | Search / browse / export | Import, add, edit, delete | Approve users |
|---|---|---|---|
| viewer (coworkers) | ✓ | ✗ | ✗ |
| editor (optional) | ✓ | ✓ | ✗ |
| admin (Ega) | ✓ | ✓ | ✓ |

Enforced in the database (RLS + `has_role`), not only hidden in the UI. New sign-ups have **no** access until approved.

## Daily flow
Admin: Import tab → pick `Stock now.xlsx` → Replace → confirm. Viewers' phones pick it up within ~60 s while the app is open (or on reopen).

## Free-tier notes
- Projects pause after ~7 days with no API traffic. Daily imports + coworker use keep it awake; if it pauses, restore from the dashboard (data is kept).
- Built-in email sender is rate-limited (a few emails/hour). For a batch onboarding either stagger sign-ups or turn off "Confirm email" (Auth → Providers → Email) — the admin approval step is the real gate.
- DB size: ~7.4k containers + audit log is a few MB; the 500 MB cap is not a concern. Audit log grows with each Replace import (only changed rows are logged).

## Automatic feed from Google Sheets (replaces daily manual import)
```
lazyit API ──(IT fetchDailyStock, every 6h)──▶ MASTER_DAILY_STOCK ──(pushStockToSupabase, hourly)──▶ Supabase ──▶ phones
```
- Script: [`apps-script/SupabaseStockPush.gs`](../apps-script/SupabaseStockPush.gs). Add it as a **new file** in the IT Daily Stock Apps Script project. IT's code is not modified, and the lazyit API is never called a second time.
- Reads `MASTER_DAILY_STOCK`, which holds the **full** stock. The `offhire` filter in IT's script applies only to the Offhire and OB copies.
- Pushes only when IT's script recorded a new successful snapshot (`SBS_LAST_API_SUCCESS_AT`). Effective data age is ≤ 6h + 1h.
- Server side: migration `003_server_import.sql` lets the `service_role` (secret key) call `apply_import`, plus `inventory_count()`.
- Guards: one-transaction replace, an 80% sudden-drop block, rows with missing fields skipped *and* protected from deletion. Every run is logged in the `SUPABASE_PUSH_LOG` tab.
- Setup: Script Properties `SUPABASE_URL` + `SUPABASE_SECRET_KEY` → run `stockPushDiagnose()` → `pushStockToSupabase()` → `setupSupabasePushTrigger()`.
