# Container Stock Tracker

Mobile-first PWA for depot operations: paste a container number (spaces and lowercase are fine) and get **Shipping line · Type · Grade · Size · Condition** within a second, online or offline. The inventory is refreshed every day from the stock Excel file.

**Stack:** React 19 + TypeScript · Vite 7 · Tailwind 3 · Supabase (Postgres, Auth, RLS) · Dexie/IndexedDB · SheetJS · vite-plugin-pwa · Lucide icons. **Tests:** Vitest, PGlite (real Postgres in WASM), Playwright (Chrome, Android viewport).

## Two run modes

| Mode | When | Database | Who sees the data |
|---|---|---|---|
| **Local-only** | No Supabase env vars set | IndexedDB in the browser | Only that phone/browser |
| **Cloud** | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set | Supabase Postgres; IndexedDB = offline cache | Every authorized user |

Local mode works with zero setup and is good for trying the app out. **For daily operations use Cloud mode.** Local data isn't backed up, and clearing Chrome's site data deletes it.

---

## 1. Run locally

```bash
npm install
npm run dev            # http://localhost:5173  (local-only mode unless .env.local exists)
```

To test on your Android phone over Wi-Fi, run `npm run dev -- --host` and open `http://<your-PC-IP>:5173`. Install-to-home-screen and the service worker need HTTPS (or localhost), so test those on the deployed URL.

## 2. Configure Supabase (cloud mode)

1. Create a project at https://supabase.com (the free tier is enough for this inventory size).
2. **SQL Editor** → paste all of [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql) → **Run**. It's safe to re-run.
3. **Authentication → Providers → Email**: keep it enabled. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". Accounts are created by you, not the public.
4. **Authentication → Users → Add user**: enter your email and a strong password, and tick "Auto confirm".
5. Authorize that user (SQL Editor):
   ```sql
   insert into public.authorized_users (user_id, role)
   select id, 'admin' from auth.users where email = 'you@example.com';
   ```
   Roles: `viewer` (search only), `editor` (edit + import), `admin`.
6. **Project Settings → API**: copy the **Project URL** and the **anon / publishable** key into `.env.local`:
   ```bash
   cp .env.example .env.local
   # VITE_SUPABASE_URL=https://xxxx.supabase.co
   # VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   ⚠️ Never put the `service_role` key in this app or in Vercel env vars for it. The anon key is safe to ship because Row Level Security blocks everything for users who aren't authorized.

## 3. Import the initial inventory

Open the app → **Import** → choose `Stock now.xlsx` → check the preview → **Replace** → confirm.

Expected result for the supplied file: **7,397 new records, 1 invalid row**. The invalid row is the footer total "7397" on row 7,399; it's reported, not silently dropped. You'll also see **1 warning**: grade `k` is normalized to `K` (BEAU5218836).

Fallback without the UI: `npm run seed -- "path/to/Stock now.xlsx"` writes `seed/initial-inventory.csv` (+ a report). Load it via Supabase **Table Editor → containers → Import data from CSV**.

## 4. Deploy (Vercel)

1. Push this folder to a GitHub repo.
2. https://vercel.com → **Add New Project** → import the repo. Framework is auto-detected as Vite (`vercel.json` is included).
3. **Environment Variables:** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy, then open the `https://….vercel.app` URL.

Any static host with HTTPS works (Netlify, Cloudflare Pages, GitHub Pages). For a sub-path such as GitHub Pages, build with `VITE_BASE=/repo-name/ npm run build`.

## 5. Open on Android

Open the HTTPS URL in **Chrome** → sign in → ⋮ menu → **Add to Home screen / Install app**. It then launches full-screen like a native app. See [docs/ANDROID_INSTALLATION.md](docs/ANDROID_INSTALLATION.md).

## 6. Update the inventory every day

**Import** → pick today's file → review **New / Updated / Removed** → **Replace** (daily snapshot) → type `REPLACE` if anything will be removed → **Apply**. Use **Merge** for partial files: it adds and updates but never removes anything. Full details are in [docs/IMPORT_GUIDE.md](docs/IMPORT_GUIDE.md).

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check + production build (PWA, service worker) |
| `npm run preview` | Serve the production build on :4173 |
| `npm test` | Unit + database tests (Vitest + PGlite) |
| `npm run test:e2e` | Playwright mobile E2E (needs Google Chrome; `PW_CHANNEL=chromium` to use Playwright's Chromium) |
| `npm run test:all` | Everything |
| `npm run seed -- <file.xlsx>` | Build `seed/initial-inventory.csv` from a stock file |

## Project layout

```
src/lib/        normalize.ts (container no. rules + ISO 6346), excel.ts (parse/detect/validate),
                diff.ts (import plan), search.ts, export.ts, format.ts, types.ts
src/data/       store.ts (inventory state, sync, offline rules), db.ts (IndexedDB), supabase.ts, backend.ts
src/screens/    Search, Inventory, Import, Dashboard, Settings, Login
src/components/ UI primitives, ResultCard, ContainerSheet (add/edit/delete)
supabase/       SQL migration (schema, RLS, transactional import RPC, audit trigger)
tests/          unit/, sql/ (migration tested in PGlite), e2e/ (Playwright), fixtures/Stock now.xlsx
docs/           ARCHITECTURE, DATABASE_SCHEMA, IMPORT_GUIDE, ANDROID_INSTALLATION, TESTING
```

## Known issue: SheetJS version

npm only ships `xlsx@0.18.5`, which has published advisories (prototype pollution / ReDoS when parsing **malicious** files). In this app, files are only ever parsed in the user's own browser from files they pick themselves, so the practical risk is low. Still, switch to the maintained build before production:

```bash
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

(The CDN was unreachable from the build environment, so this hasn't been done yet. All tests pass on 0.18.5, and the API is identical.)
