# Architecture

```
            ┌───────────────────────────── Android Chrome (installed PWA) ─────────────────────────────┐
            │  React UI (Search · Inventory · Import · Dashboard · Settings)                            │
            │        │                                                                                  │
            │  InventoryStore  ── in-memory Map<normalizedNo, record>  (O(1) search, ~7.4k rows ≈ 2 MB) │
            │        │  load on start            ▲ write-through                                        │
            │  IndexedDB (Dexie): containers · imports · meta(lastSyncAt, serverVersion)                │
            │        │                                                                                  │
            │  Service worker (Workbox): precaches app shell + all JS chunks → app opens offline        │
            └────────┼──────────────────────────────────────────────────────────────────────────────────┘
                     │ HTTPS (anon key + user JWT)            — cloud mode only —
            ┌────────▼────────────────────────── Supabase ───────────────────────────────┐
            │ Auth (email/password) → authorized_users allow-list → RLS on every table    │
            │ containers (PK = normalized no.) · import_batches · audit_log · inventory_state │
            │ apply_import() RPC: one transaction, all-or-nothing                          │
            └─────────────────────────────────────────────────────────────────────────────┘
```

## Key decisions

| Decision | Why | Trade-off |
|---|---|---|
| **Whole inventory in memory + IndexedDB** | 7.4k rows ≈ 1 MB of JSON. Exact lookup is a `Map.get`, which is instant and works offline. | Doesn't scale past ~100k rows without changes (still fine for one depot). |
| **Full snapshot sync, gated by a version number** | A statement-level trigger bumps `inventory_state.version`. The client polls that tiny row and downloads only when it changed. No tombstones or delta logic to get wrong. | ~1 MB download after each change (a daily import). Acceptable on 4G. |
| **Consistent snapshot** | The version is read before and after paging. If it moved mid-download, the client retries, so it never caches a half-old, half-new inventory. | Up to 3 retries. |
| **Edits blocked while offline (cloud mode)** | The spec allowed "safe queue OR restrict". A queue risks silently overwriting a newer import made from another device. For an ops tool, blocking is the safer default. | No offline edits. Search stays fully offline. |
| **Optimistic concurrency on edits** | `update … where updated_at = <value you loaded>`. If someone else changed the row, you get a conflict instead of a lost update. | User must refresh and redo. |
| **Server recomputes import diff** | The preview is computed on the device. `apply_import` recomputes on the server inside the transaction and returns the authoritative counts, shown in the completion report. A banner explains any difference from the preview. | — |
| **Replace mode protects invalid rows** | If a container's row is broken in today's file, that isn't evidence it left the depot, so it's kept instead of deleted. | A truly gone container with a broken row lingers until a clean file arrives. |
| **Hash routing** | Works on any static host and inside the PWA with no rewrites. | URLs look like `/#/inventory`. |
| **Code splitting** | SheetJS (~430 KB) loads only for Import/Settings. Search opens fast. | All chunks are precached, so it still works offline. |

## Container-number normalization (single rule, used everywhere)

`src/lib/normalize.ts → normalizeContainerNumber`: removes **all** whitespace (space, tab, CR/LF, NBSP, zero-width, other Unicode spaces) and the separators `- . / _`, then uppercases. Letters and digits are never removed. The database enforces the result with `CHECK (container_no ~ '^[A-Z0-9]+$')` and the primary key, so non-normalized or duplicate numbers can't be stored. The original spacing is kept in `display_no`.

Extras:
- **ISO 6346 check digit** validation. All 7,397 numbers in the supplied file pass. A mismatch is a *warning* (imported, flagged) because the depot system is the source of truth.
- **Pasted sentences**: "pls check cont axiu 149 845 0" still finds AXIU1498450. This runs only when there is no exact match.
- **Missing check digit**: typing 10 characters suggests the full number. It's shown as a suggestion, never as the result.

## Sync states

| State | Meaning |
|---|---|
| `local-only` | No Supabase configured. This device is the database. |
| `synced` | Online and the cache matches the server version. |
| `syncing` | Downloading. |
| `sync-required` | The server has a newer version (detected on start, focus, every 60 s, or reconnect). An automatic pull follows. |
| `sync-failed` | Online but the server call failed. The cache is kept and the error is shown in Settings. |
| `offline` | No network. Search uses the last snapshot, and every result shows "Offline copy as of …". |
