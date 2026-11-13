# Import guide

## Daily routine (about 1 minute)
1. Export today's stock from the depot system as Excel (`.xlsx` or `.xls`).
2. Open the app → **Import** → **Choose Excel file**.
3. Check that **Column mapping** shows Container number = `Cont`, Shipping line = `Owner`, and Type/Grade/Size/Condition = the matching columns.
4. Read **File check** and **What will change**.
5. Choose **Replace** (normal daily snapshot) → **Review & confirm** → if anything will be removed, type `REPLACE` → **Apply import**.
6. The completion report shows what was actually applied. The **Import history** in Settings keeps every run, including failed ones.

## What the importer understands
- **Sheets:** it picks the sheet that looks most like inventory. You can switch sheets.
- **Header row:** auto-detected within the first 30 rows (title rows above the header are fine). You can override it.
- **Columns:** auto-detected by name (`Cont`, `Container No`, `Owner`, `Shipping Line`, `Operator`, `Type`, `Grade`, `Size`, `Condition`, plus Indonesian variants such as `Nomor Kontainer`, `Ukuran`, `Kondisi`). Matching is exact, so `Grade Remark` is never confused with `Grade`. Anything else can be mapped by hand.
- **Values:** trimmed and uppercased (`k` → `K`, reported as a warning). Size `40` stored as a number is read as `40`.

## Validation, nothing silently dropped
| Situation | What happens |
|---|---|
| Blank row | Skipped and counted under "Empty rows" |
| Container number not 4 letters + 7 digits (e.g. the footer total `7397`) | **Invalid**, listed with its Excel row number and reason |
| Any of the 5 fields blank | **Invalid** |
| ISO 6346 check digit wrong | Imported with a **warning**. Verify the number. |
| Same container twice, identical values | First row kept, reported under **Duplicates** |
| Same container twice, **different** values | **All** of its rows are excluded as invalid. Fix the file. |

**Download issues report** gives you an Excel file listing every invalid row, duplicate, and warning.

## Replace vs Merge
| | Replace (daily snapshot) | Merge |
|---|---|---|
| New in file | added | added |
| Changed in file | updated | updated |
| Not in file | **removed** | kept |
| In file but row invalid | **kept** (protected) | kept |
| Confirmation | type `REPLACE` when removals > 0. A red warning appears if more than 20% of the inventory would be removed. | single confirm |

Use **Merge** when the file is partial (one shipping line only, a correction list, etc.). A partial file in Replace mode would remove everything it doesn't contain, and that's exactly what the 20% warning is there to catch.

## Safety guarantees
- **All-or-nothing:** cloud imports run in one Postgres transaction, and local imports in one IndexedDB transaction. If anything fails, the inventory is unchanged and a *failed* entry is written to history.
- An empty file never wipes the inventory: imports with 0 valid rows are refused.
- Cloud mode: every change is in `audit_log` with the import id, so you can always see what an import changed.
- Importing requires a connection in cloud mode. Offline, you can preview a file but not apply it.

## Expected result for the supplied `Stock now.xlsx`
7,397 valid, 1 invalid (footer total row), 0 duplicates, 1 warning (lowercase grade normalized).
