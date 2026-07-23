# Phase 1D Backfill — GLEEM Financial Ownership

**Resolve GLEEM only via:** `WHERE BranchCode = N'GLEEM'`

## Invoice (`TblinvServHead`)

For every row:

1. `BranchID = GLEEM`
2. `BusinessDayID` = shift.`BusinessDayID` if `ShiftMoveID` present
3. Else GLEEM + `invDate` → `TblNewDay.ID`
4. Else unresolved (none found on last132)

Expected: **7749** invoices → GLEEM; **0** null BusinessDayID.

## Cash (`TblCashMove`)

Same mapping priority.

Expected at Phase 1D mapping probe: **11713** cash → GLEEM BranchID; **17** null BusinessDayID.

**Phase 1E preflight correction (2026-07-22):** live `last132` count progressed during the day:

| Checkpoint | Count | TotalAmount |
|---|---:|---:|
| Phase 1D design probe | 17 | — |
| Phase 1D closure | 18 | 1,800,000 |
| Phase 1E morning preflight | 18 | 1,800,000 |
| Phase 1E migration/verify | **19** | **1,900,000** |

All rows: BranchID=GLEEM, invDate=2024-01-01, invType=`ايرادات`, inOut=`in`, ExpINID=36. Do not fabricate days; reporting includes them via `BranchID` + `invDate`. **Authoritative Phase 1E count: 19.**

## Reconciliation (`TblTreasuryCloseRecon`)

`BranchID = referenced TblNewDay.BranchID`. Empty table on last132 at migration time; column still NOT NULL for future inserts.

## Invariants preserved

Amounts, invIDs, invTypes, dates, payment values, ledger counts, target recalc counts unchanged (fingerprint compare).
