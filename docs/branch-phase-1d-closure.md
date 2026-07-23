# Phase 1D Closure — Financial Transaction Ownership

**Status:** Complete  
**Date:** 2026-07-22  
**Database:** cloud / `last132`  
**Founding branch:** GLEEM (`BranchCode = N'GLEEM'`) → BranchID **1**

## 1. Live dependencies found

See `docs/branch-phase-1d-financial-dependency-audit.md`.

Critical: `InsCashMoveSales` was single-row scalar; CT enabled on Head/CashMove; sync registry enabled for those tables; 18 cash rows cannot map BusinessDayID (2024-01-01 income without day).

## 2. Trigger definitions and changes

Replaced `InsCashMoveSales` with set-based multi-row logic preserving live invType/ReservTime rules and inheriting `BranchID`/`BusinessDayID` from inserted invoice heads.

## 3. Tables and columns changed

| Table | Columns |
|---|---|
| `TblinvServHead` | `BranchID NOT NULL`, `BusinessDayID NOT NULL` |
| `TblCashMove` | `BranchID NOT NULL`, `BusinessDayID` nullable for legacy |
| `TblTreasuryCloseRecon` | `BranchID NOT NULL` |

## 4. Constraints and indexes

FKs: `FK_TblinvServHead_BranchID/BusinessDayID`, `FK_TblCashMove_BranchID/BusinessDayID`, `FK_TblTreasuryCloseRecon_BranchID`.  
Indexes: branch+date / branch+day / cash branch+PM+date / recon branch+NewDay.

## 5. GLEEM backfill counts

* Invoices: **7749** → GLEEM, **0** null BusinessDayID  
* Cash: **11714** → GLEEM BranchID; legacy null BusinessDayID count later corrected by Phase 1E to **19** (see backfill doc)  
* Recon: **0** rows (column enforced for future)

## 6. Unresolved legacy rows

Originally 18 at 1D closure; Phase 1E live count **19** `ايرادات` cash rows dated 2024-01-01 with no `TblNewDay` and null shift. Future cleanup task — do not fabricate days.

## 7. Sales ownership flow

Active branch day/shift gate → stamp head → children inherit → trigger + split cash inherit invoice ownership. Browser `branchId` ignored.

## 8. Non-sale cash ownership flow

Expenses/incomes/deductions/transfers/tips/funding/payout/payroll stamp from server branch+day. Past-date uses `resolveBranchDayForDate` (no open-day attach, no auto-create).

## 9. Delete/reversal protections

Invoice/expense/income mutations validate persisted BranchID vs active branch; wrong-branch → 404 / `غير موجود`. Ownership immutable.

## 10. Treasury isolation

Recon inserts BranchID; operational treasury GETs filter by active branch.

## 11. Active-branch read isolation

Sales today/recent/more/recent-invoices, expenses/incomes/deductions lists, treasury ops filtered. Owner/partner/full-day marked unsafe until reporting phase.

## 12. Cache changes

`buildRecentInvoicesCacheKey` includes `branchId`; hook accepts optional branchId from session.

## 13. Change Tracking state

Before/after: **CT remains enabled** on `TblinvServHead` and `TblCashMove` with `TRACK_COLUMNS_UPDATED`. Recon still no CT.

## 14. Sync-service status

`sync.TableRegistry` still lists financial tables enabled. **Keep sync stopped and unused.**

**Phase 1E infrastructure note (2026-07-22):** cloud `last132` is the only source of truth. There is no active local database alignment requirement. Sync must not be resumed and must not block reporting work. Do not drop BranchID columns for legacy sync.

## 15. Pre/post fingerprints

Matched after final migration run: invoice/cash/payment counts, grand totals, cash in/out sums, checksums (amount/identity columns).

## 16. Tests and commands

```bash
npx tsx scripts/run-financial-branch-ownership-migration.ts --mode=cloud --expected-database=last132
npx tsx scripts/verify-financial-branch-ownership.ts --mode=cloud --expected-database=last132
npx vitest run src/lib/__tests__/phase1dFinancialOwnership.test.ts
npx vitest run src/lib/__tests__/phase1aSecurityBaseline.test.ts src/lib/__tests__/phase1bBranchContext.test.ts
```

## 17. Known limitations

* 18 cash rows without BusinessDayID  
* Bookings lack BranchID — convert uses active branch only  
* Owner/partner/full-day reports still global  
* No second branch; no switch API/UI  
* Local DB not yet migrated

## 18. Exact boundary before next phase

Financial roots own BranchID. Next dependency-based scope should be **reporting / consolidated reads** or **booking/queue ownership** — not both. Do not enable a second branch until reporting isolation is planned.

## 19. Go/no-go

**GO** for Phase 1D completion on cloud `last132`, subject to: sync remains stopped until local alignment; no second branch; no consolidated reporting yet.
