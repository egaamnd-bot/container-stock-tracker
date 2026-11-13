# Database schema (Supabase / PostgreSQL)

Source: [`supabase/migrations/001_init.sql`](../supabase/migrations/001_init.sql). It's idempotent, and it's tested in CI against real Postgres 17 (PGlite).

## Tables

### `containers`: current inventory
| Column | Type | Notes |
|---|---|---|
| `container_no` | text **PK** | Normalized. `CHECK ^[A-Z0-9]+$`, length 4–15. Uniqueness comes from the PK. |
| `display_no` | text | Original formatting, e.g. `AXIU 149 845 0` |
| `shipping_line`, `type`, `grade`, `size`, `condition` | text NOT NULL | Non-blank check. Uppercased by the importer. |
| `created_at`, `updated_at` | timestamptz | Set by trigger. `updated_at` is also the optimistic-lock token. |
| `updated_by` | uuid | `auth.uid()` via trigger |
| `last_import_id` | uuid | The import that last touched the row |

### `import_batches`: import history
Mode, filename, sheet, and the counts `total_rows / added / updated / unchanged / removed / invalid / duplicates`, plus `status` (`completed` | `failed`), `error`, `created_by`, `created_at`. Failed imports are logged *after* the rollback, so the history shows them.

### `audit_log`: every change, forever
`action` (insert/update/delete), `container_no`, `source` (`manual` | `import`), `import_id`, `old_data`, `new_data` (jsonb), `actor`, `at`. It's written only by a `SECURITY DEFINER` trigger. Clients can read it but can't write it.

Example: the full history of one container:
```sql
select at, action, source, old_data->>'condition' as was, new_data->>'condition' as now
from audit_log where container_no = 'AXIU1498450' order by at;
```

### `inventory_state`: one row with `version`
Bumped by a statement-level trigger on any change to `containers`. Clients compare it with their cached version to decide whether to re-download.

### `authorized_users`: allow-list
`user_id → auth.users`, `role ∈ {viewer, editor, admin}`. Signing in isn't enough: the user must be listed here.

## `apply_import(p_mode, p_rows, p_filename, p_sheet_name, p_total_rows, p_invalid, p_duplicates, p_protected)`
Runs as the calling user (`SECURITY INVOKER`, so RLS applies) inside **one transaction**:
1. Requires the `editor` role. Refuses an empty payload, which would otherwise wipe the inventory in replace mode.
2. Stages and re-normalizes the rows. Rejects duplicates.
3. Inserts the `import_batches` row and tags the audit entries with its id.
4. `UPDATE` only rows whose 5 fields actually differ, then `INSERT` new rows, then (replace mode only) `DELETE` absent rows except `p_protected` (numbers whose file row was invalid).
5. Returns the batch with the server-computed counts.

Any error, including a single bad row, rolls back **everything**, including the history row. This is proven by `tests/sql/schema.test.ts`.

## Row Level Security matrix

| | anon | signed in, not listed | viewer | editor/admin |
|---|---|---|---|---|
| containers SELECT | ✗ | 0 rows | ✓ | ✓ |
| containers INSERT/UPDATE/DELETE | ✗ | ✗ | ✗ | ✓ |
| apply_import | ✗ | ✗ (error) | ✗ (error) | ✓ |
| import_batches SELECT | ✗ | ✗ | ✓ | ✓ |
| audit_log SELECT | ✗ | ✗ | ✓ | ✓ |
| audit_log write | ✗ | ✗ | ✗ | ✗ (trigger only) |

## Adding users later
Create the user in **Authentication → Users**, then:
```sql
insert into authorized_users (user_id, role) select id, 'viewer' from auth.users where email = 'colleague@company.com';
```
Remove access: `delete from authorized_users where user_id = …;`. The user's next sync returns nothing.
