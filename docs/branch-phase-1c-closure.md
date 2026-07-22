# Phase 1C Closure — Branch-Scoped Business Day & Shift

**Status:** Complete  
**Date:** 2026-07-22  
**Database:** cloud / `last132`

## 1. Live dependencies found

See `docs/branch-phase-1c-day-shift-dependency-audit.md`.

Critical live facts:

* PK was on `TblNewDay.NewDay` (date)
* FK `TblShiftMove.NewDay → TblNewDay.NewDay` CASCADE
* Change Tracking on `TblNewDay` required temporary disable for PK swap
* `TblTreasuryCloseRecon.NewDay` already stored day **ID** (INT) with no FK
* Financial tables reference `TblShiftMove.ID` only (no day-date FK)

## 2–6. Schema / backfill / services

Documented in:

* `branch-phase-1c-schema.md`
* `branch-phase-1c-backfill.md`
* `branch-phase-1c-business-day-service.md`
* `branch-phase-1c-shift-service.md`

## 7. Compatibility changes

* `TblTreasuryCloseRecon`: added FK `NewDay → TblNewDay.ID` only
* `TblShiftMove.NewDay` retained as denormalized compatibility column

## 8. API / resolver changes

* Day open/close/close-and-open/status → active branch services
* Shift open/close → active branch services; global force-close removed
* Sales / expenses / deductions write gates → `resolveBranchDayAndShiftForWrite`
* Session day payload → branch open day
* Treasury reconciliation / transfer day selection → branch-scoped
* Expenses `today=1` filter → branch open day

## 9. Explicit boundary statement

```text
Branch-aware day/shift gating is complete.
Financial row ownership is not complete until Phase 1D.
```

## 10. Tests / commands

* `npx tsx scripts/run-branch-business-day-and-shift-migration.ts` — passed twice
* `npx vitest run` Phase 1A/1B/1C + treasury/booking suites (see final report)
* Production build when feasible

## 11. Known limitations

* Legacy SPs/views (`EndShift`, report procs) unchanged
* Financial aggregates still lack `BranchID`
* CT version history for `TblNewDay` reset by required PK swap
* Second branch not seeded/enabled
* No switch API/UI

## 12. Phase 1D recommendation only

```text
Financial transaction roots:
TblinvServHead
TblCashMove
Treasury close/reconciliation ownership
Payment and transaction branch inheritance
```

**Do not start Phase 1D in this closure.**
