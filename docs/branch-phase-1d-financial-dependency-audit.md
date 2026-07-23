# Phase 1D — Financial Dependency Audit

**Date:** 2026-07-22  
**Database:** cloud / `last132`  
**Artifact:** `scripts/audit-branches/_phase1d-live-schema-audit.json`

## Summary

| Object | Type | Current ownership | Branch risk | Phase 1D change | Transaction boundary | Trigger/CT | Deferred |
|---|---|---|---|---|---|---|---|
| `TblinvServHead` | Table | Shift → day (indirect) | Cross-branch mix on reads/writes | Add `BranchID`, `BusinessDayID` | Sales create TX + invoice update TX | CT ON; `InsCashMoveSales` | Per-branch inv numbering |
| `TblinvServDetail` | Child | Via head | Low if head gated | Inherit only; no column | Same as head | CT ON | Denorm later if needed |
| `TblinvServPayment` | Child | Via head + ShiftMoveID | Medium (shift mismatch) | Inherit; validate shift branch | Same as head | No CT | Denorm later if needed |
| `TblCashMove` | Table | Shift / date | High — unscoped lists | Add `BranchID`, `BusinessDayID` | Per write TX | CT ON | Inter-branch transfers |
| `TblTreasuryCloseRecon` | Table | NewDay ID → day | Medium | Add `BranchID` (= day.BranchID) | Close-day TX | No CT | — |
| `TblShiftMove` | Ops root | Phase 1C owned | — | No change | — | CT ON | — |
| `TblNewDay` | Ops root | Phase 1C owned | — | No change | — | CT ON | — |
| `InsCashMoveSales` | Trigger | None | Single-row scalar; no branch | Multi-row + inherit head Branch/Day | Inside invoice INSERT | Replaced | — |
| `trg_TblinvServDetail_WhatsAppNotification` | Trigger | N/A | Disabled | None | — | Disabled | — |
| `sync.TableRegistry` | Sync meta | Tables enabled | Schema drift if local lags | Document align-before-resume | N/A | CT preserved | Sync redesign |
| `sp_Loyalty_EarnPointsFromSale` | SP | Invoice ID | Loyalty global OK | None | After sale | — | Branch display later |
| Sales POST | App | 1C day/shift gate | No financial BranchID | Stamp head ownership | Applock + TX | Trigger cash | — |
| Invoice update/delete | App | Unscoped | Cross-branch mutate | Active-branch ownership check | Audited TX | App rewrites cash | — |
| Expenses/incomes/deductions | App | Partial 1C | Lists mixed | Stamp + filter BranchID | Per route TX | — | — |
| Past-date expense/income | App | Global | Wrong day/branch | Resolve `(branch, date)` day | Per route | — | Auto-create day |
| Tips/funding/payout/payroll cash | App | Global | Wrong branch stamp | Explicit server branch+day | Per service TX | — | Ledger BranchID |
| Treasury transfer/recon | App | Partial 1C | Recon missing BranchID | Stamp + filter | TX | — | — |
| Booking convert | App | Global day/shift | Sale in wrong branch | Active branch ownership | TX | No cash for `خدمة` | Booking BranchID |
| Owner/partner/full-day reports | App | Global | Unsafe for 2nd branch | Comment only | — | — | Reporting phase |

## Live trigger (before)

`InsCashMoveSales` used scalar `@var = (SELECT … FROM inserted)` and handled:

* `مبيعات بالكارت` + null ReservTime → cash **out**
* `م.مبيعات بالكارت` → cash **in**
* `مبيعات` + null ReservTime → cash **in**
* `م.مبيعات` → cash **out**

## BusinessDayID mapping probe

| Set | Total | Via shift | Via Branch+invDate | Unresolved |
|---|---:|---:|---:|---:|
| Invoices | 7749 | 7745 | 4 | 0 |
| Cash | 11713 | 10328 | 1368 | **17** (probe at design time) |
| Recon | 0 | — | — | 0 |

Unresolved cash at design probe: 17 `ايرادات` rows dated `2024-01-01` with no matching `TblNewDay` and null `ShiftMoveID`.

**Phase 1E preflight correction (2026-07-22):** live count at completion is **19** (same shape; rows continue to appear as 2024-01-01 income without day). Keep `BusinessDayID` nullable for those legacy rows only; new writes require it. Reports include them via `BranchID`, never require non-null `BusinessDayID`.

## Child strategy

Aggregate ownership stays on `TblinvServHead` / `TblCashMove` / `TblTreasuryCloseRecon`. No `BranchID` on detail or payment unless a future integrity proof appears.
