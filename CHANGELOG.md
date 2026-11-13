# Changelog

## 1.1.0 (2026-11-13)
Shared inventory on Supabase.
- Admin / viewer roles enforced in the database; viewers get search, browse, dashboard and export only.
- Request-access sign-up + in-app **Settings → Users** approval panel for admins (no SQL needed after bootstrap).
- New users default to viewer; admins cannot demote themselves.
- Migration `002_roles_admin.sql`; setup guide `docs/SUPABASE_SETUP.md`.

## 1.0.0 (2026-11-13)
Initial release.
- Instant container search with normalization (spaces/tabs/line breaks/case/separators), ISO 6346 check-digit validation, extraction of numbers from pasted text, and labelled suggestions only when there's no exact match.
- Result card with the five fields, **Copy fields** and **Copy all** buttons, and an offline-age notice.
- Excel import (.xlsx/.xls): sheet picker, header detection, auto + manual column mapping, validation, duplicate detection, preview of added/updated/unchanged/removed, Replace & Merge modes, typed confirmation for removals, a >20% removal warning, an issues report download, and a completion report.
- Inventory list with filters (line/type/grade/size/condition), sorting, details, add/edit/delete.
- Dashboard: totals and breakdowns by line, size, type, condition, grade; recently updated; latest import.
- Settings: DB status, sync now, Excel/CSV backup (re-importable), import history, theme, install button, version.
- Offline-first PWA: IndexedDB cache, precached app shell, sync status indicators, edits blocked while offline.
- Supabase: schema, RLS with roles, transactional `apply_import` RPC with rollback, audit log trigger, inventory version for cheap staleness checks.
- 88 automated tests (unit, real Postgres via PGlite, Playwright mobile E2E).
