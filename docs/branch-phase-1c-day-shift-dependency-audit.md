# Phase 1C Dependency Audit — Business Day & Shift

**Date:** 2026-07-22  
**Database:** cloud / `last132`  
**Live audit artifact:** `scripts/audit-branches/_phase1c-live-schema-audit.json`

## Live schema facts

| Object | Finding |
|---|---|
| `TblNewDay` columns | `ID INT IDENTITY NOT NULL`, `NewDay DATE NOT NULL`, `Status BIT NULL` |
| `TblNewDay` PK | **`PK_TblNewDay (NewDay)`** — date-based, blocks multi-branch same date |
| `TblNewDay.ID` | Non-null, unique (358/358), stable identity — safe candidate PK |
| `TblShiftMove` PK | `PK_TblShiftMove (ID)` |
| FK to day | `FK_TblShiftMove_TblNewDay`: `TblShiftMove.NewDay → TblNewDay.NewDay` **CASCADE** |
| FKs to shift | `TblCashMove`, `TblinvServHead`, `TblinvPurchaseHead`, `TblinvServPayment`, `TblLoyaltyPointLedger` all reference `TblShiftMove.ID` via `ShiftMoveID` |
| `TblTreasuryCloseRecon.NewDay` | **INT** (stores day **ID** in app), **no live FK** |
| Duplicate `NewDay` dates | None |
| Orphan shift dates | None |
| Users with multiple open shifts | None |
| `BranchID` / `BusinessDayID` on day/shift | Not present yet |
| GLEEM | `BranchID` resolved by code (live identity observed as 1; never hardcode) |

## Dependency matrix

| Object | Dependency type | Current key used | Required Phase 1C change | Compatibility-only? | Risk |
|---|---|---|---|---|---|
| `PK_TblNewDay` | Primary key | `NewDay` (date) | Replace with PK on `ID`; add `UNIQUE (BranchID, NewDay)` | No | High — blocks multi-branch same date; **Change Tracking requires temporary disable to drop PK** |

| `FK_TblShiftMove_TblNewDay` | FK + CASCADE | `ShiftMove.NewDay → NewDay.NewDay` | Drop; add `BusinessDayID → TblNewDay.ID`; keep `NewDay` denormalized | Partial | High — must drop before PK swap |
| `TblNewDay` app open/close | Application SQL | Global `Status=1` | Scope by `BranchID` from session | No | High |
| `TblShiftMove` app open/close | Application SQL | Global / user `Status=1` | Set `BranchID`+`BusinessDayID`; force-close by branch only; open-shift uniqueness remains **user-global** | No | High |
| `day/close`, `day/close-and-open` | Global UPDATE | `UPDATE … WHERE Status=1` (all shifts) | Branch-filtered force-close only | No | Critical |
| Sales/expenses/deductions/booking convert | App gate | Global open day + user open shift | Resolve branch open day / validate shift branch | Yes (financial rows still unscoped) | Medium |
| `treasuryActions.closeTreasuryDay` | App | Find day by date globally; close by ID | Resolve day by **(BranchID, date)**; do not change amounts | Yes | Medium |
| `TblTreasuryCloseRecon.NewDay` | Soft day ref (INT=ID) | Day ID without FK | After PK on `ID`, add FK `NewDay → TblNewDay.ID`; optional document as BusinessDayID synonym | Yes | Low |
| Invoice/cash/payment ShiftMoveID FKs | FK to shift ID | `ShiftMoveID → TblShiftMove.ID` | **No schema change** in 1C | Yes | Low |
| Legacy SPs/views (`EndShift`, `ViwShiftMove`, cash/sales reports) | SQL modules | Historical date/shift joins | Leave as-is; out of POS write path; document | Yes | Medium (legacy reporting) |
| `SalonID` loyalty columns | Unrelated | Nullable salon | **Do not touch** | n/a | n/a |

## Direct dependent tables receiving key migration

| Table | Change in Phase 1C | Notes |
|---|---|---|
| `TblNewDay` | Add `BranchID`; PK → `ID`; unique `(BranchID, NewDay)`; filtered one-open-per-branch | Core ownership |
| `TblShiftMove` | Add `BranchID`, `BusinessDayID`; FK to branch + day ID; keep `NewDay` | Core ownership |
| `TblTreasuryCloseRecon` | Add FK from existing INT `NewDay` column to `TblNewDay.ID` | Compatibility only — **not** financial BranchID isolation |

**Stop condition:** No need to add `BranchID` to invoices/cash for day/shift integrity. Phase 1D remains financial ownership.

## Application SQL hotspots (must update)

* `src/app/api/day/open|close|close-and-open|route|rollover-check|summary|history`
* `src/app/api/shift/open|close|route|summary|history`
* `src/app/api/shifts/*`, `src/app/api/auth/session`
* `src/lib/actions/treasuryActions.ts`
* Sales / expenses / deductions / incomes / booking convert open-day+shift gates
* `src/app/api/operations/status`

## Explicit non-goals confirmed by audit

* No FK forces `BranchID` onto `TblinvServHead` / `TblCashMove` for Phase 1C
* Treasury formulas unchanged
* Booking/queue numbering unchanged
