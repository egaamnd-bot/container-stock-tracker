# Development log

## 2026-11-13: v1.0.0 build

### Phase 1: Workbook inspection
- `Stock now.xlsx`: 1 sheet (`Sheet`), header on row 1, 27 columns, 7,398 data rows.
- Relevant columns: **Cont** (container no., formatted `ACLU 279 937 0`), **Owner** (shipping line), **Type**, **Grade**, **Size**, **Condition**. Not used: BU, Mnf Year, Location and 20 others.
- Findings: 7,397 containers, 0 duplicates, **all pass the ISO 6346 check digit**. The last row is a footer total (`7397` in the Cont column). One lowercase grade (`k`, BEAU5218836). One fully empty-attribute row (the footer).

### Phase 2: Core logic (`src/lib`)
Normalization + ISO 6346, Excel reader/header detection/auto-mapping/validation/duplicates, import diff (replace/merge/protected), search, export.
Bug found & fixed: row numbers would be wrong for sheets whose used range doesn't start at A1 → added `rowOffset`.
Bug found & fixed: Unicode escapes in the normalization regex were turned into literal characters when written → now built with `new RegExp` using escaped strings.

### Phase 3: Database + data layer
`supabase/migrations/001_init.sql` (schema, RLS, `apply_import` RPC, audit + version triggers), tested in PGlite. Dexie cache, `InventoryStore` (local/cloud modes, sync, offline rules, optimistic concurrency).

### Phase 4: UI
Search, Inventory, Import, Dashboard, Settings, Login. Bottom nav, hash routing, theme, install prompt, code-split heavy screens (main bundle 181 KB gz).
Bug found by E2E & fixed: after editing a record, the search result card kept showing the old value → store now exposes a `rev` counter that all views depend on.

### Phase 5: Tests
79 unit/DB tests + 9 Playwright mobile E2E tests, all passing. See `docs/TESTING.md`.

### Files
`src/**` (app), `supabase/migrations/001_init.sql`, `tests/**`, `scripts/build-seed.ts`, `seed/initial-inventory.csv` (+ report), `vercel.json`, `docs/*`, README, CHANGELOG.

### Known issues
1. `xlsx@0.18.5` has npm advisories (malicious-file ReDoS / prototype pollution). Low practical risk (the user parses only their own files). Fix: install the 0.20.3 tarball from cdn.sheetjs.com (blocked from the build sandbox).
2. Not yet run against a live Supabase project, so it needs one manual smoke test after setup.
3. Edits are disabled offline (by design). An offline edit queue could be added later if field users need it.
4. `display_no` for manually added containers uses the `AXIU 149 845 0` layout. Imported ones keep the source layout.

### Next priorities
1. Create the Supabase project + deploy to Vercel (needs the account owner).
2. Swap SheetJS to 0.20.3.
3. Consider adding **Location** (yard block) to the record. It's in the source file and probably the next thing an operator asks after "what grade is it".
4. Optional: CSV import, bulk search (paste a list of numbers → table), audit-history view per container in the app.
