# Testing

```bash
npm test            # 79 unit + database tests (Vitest, PGlite)
npm run build && npm run test:e2e   # 9 Playwright E2E tests in Chrome, Android viewport 412×915
```

## Results (2026-11-13)
| Suite | Tests | Result |
|---|---|---|
| `tests/unit/normalize.test.ts`: normalization (spaces, tabs, line breaks, NBSP, zero-width, case, separators), ISO 6346, extraction | 22 | ✅ pass |
| `tests/unit/search.test.ts`: exact, not found, empty, pasted, exact-beats-partial, suggestions, filters | 14 | ✅ pass |
| `tests/unit/excel-import.test.ts`: **real `Stock now.xlsx`**, missing columns, header detection, empty/invalid rows, duplicates (identical/conflicting), check digit, numeric cells, manual mapping, `.xls`, row offsets, replace/merge/protected plans, **backup export re-imports with 0 changes** | 18 | ✅ pass |
| `tests/unit/store.test.ts`: local import of the real file + reload persistence, replace/merge, **failed-import rollback**, CRUD validation, cloud sync, **offline search from cache**, offline edit blocking, **reconnection re-sync**, version polling, sync-failed, **optimistic-lock conflict**, cloud import | 13 | ✅ pass |
| `tests/sql/schema.test.ts`: migration in real Postgres: idempotency, normalization CHECK, unique PK, **RLS** (anon / unauthorized / viewer), audit-log write protection, apply_import merge/replace/protected, empty-payload refusal, **rollback on a bad row**, duplicate payload, **full 7,397-row import (~0.8 s)** | 12 | ✅ pass |
| `tests/e2e/app.spec.ts`: Android portrait layout (no overflow, ≥44 px targets, bottom nav), **UI import of the real file**, all 6 spacing variants of AXIU1498450 → MSL/HU/K/40/DM, live search on typing, copy buttons (clipboard verified), not-found, empty search, filters, dashboard, edit + delete, merge vs replace + typed confirmation, **PWA manifest + service worker + offline reload + offline search**, dark theme | 9 | ✅ pass |

Screenshots from the E2E run are written to `test-results/screens/` (not committed).

## Not covered by automated tests (requires external setup)
- **Live Supabase project:** the SQL is verified in PGlite (same Postgres engine) and the sync logic against an in-memory fake of the backend, but not against a real Supabase instance with real Auth/JWTs or PostgREST paging. Do one manual smoke test after setup: sign in → import → search → edit → check `audit_log`.
- **Real Android device install prompt:** the manifest, icons, service worker and offline behaviour are verified in Chrome with an Android viewport and UA. The actual "Install app" dialog only appears on a real device over HTTPS.
- Performance on low-end phones: parsing the 7,398-row file takes about 1–2 s on a desktop and is expected to take a few seconds on a mid-range phone.
