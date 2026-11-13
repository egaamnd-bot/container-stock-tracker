# Shared inventory (Supabase) — setup & operations

**Project:** `xrkbhopqyxoahusaozkc` (Seoul, ap-northeast-2) · **App:** https://sbsopex.github.io/container-stock-tracker/

## One-time setup (done 2026-11-13)
1. SQL Editor → ran `supabase/migrations/001_init.sql` + `002_roles_admin.sql` ✅
2. Auth → URL Configuration → Site URL = the GitHub Pages URL ✅
3. GitHub repo → Settings → Secrets and variables → Actions:
   - `VITE_SUPABASE_URL` = `https://xrkbhopqyxoahusaozkc.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the **publishable** key (`sb_publishable_…`). Never the `sb_secret_…` key.
4. Push to `main` → the workflow builds with these and deploys. The app switches from local-only to shared mode.

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
