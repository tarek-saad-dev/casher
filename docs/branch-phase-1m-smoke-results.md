# Phase 1M — Smoke Results

**Status:** PASS (controlled run on cloud / `last132`)  
**SmokeRunID:** `3`  
**WorkDate:** `2026-07-26` (Africa/Cairo)  
**ActorUserID:** `10`  
**Started:** ~2026-07-25T23:43:13Z (capture) / transition+start during run  
**Completed / CLEANED:** same session; final LifecycleStatus=`SETUP`

---

## Final status

| Item | Result |
|---|---|
| Run Status | **PASSED** then **CLEANED** |
| ExternalSideEffectsEnabled | **0** |
| PH1GTEST IsActive during smoke | **0** |
| PH1GTEST PublicBookingEnabled | **0** |
| Returned to SETUP after cleanup | **Yes** |
| GLEEM Lifecycle | remained **PUBLIC_LIVE** |

---

## A–M execution (factual)

| Step | Result | Evidence |
|---|---|---|
| A Access / isolation | **PASS** | Smoke rejects GLEEM BranchID; missing SmokeRunID rejected; IsActive stayed 0 |
| B Employee setup | **PASS** | EmpID=1036 `[SMOKE] Employee`, assignment=17, payroll plan=16 hourly@50 |
| C Attendance | **PASS** | AttendanceID=2897 BranchID=2 check-in 10:00 / out 14:00 |
| D Booking + queue | **PASS** | BookingID=2133, QueueTicketID=149, BranchID=2, source=`phase1m-smoke` |
| E/F Sales/treasury | **PASS*** | Controlled `TblCashMove` ID=36673 BranchID=2 Amount=100 `[SMOKE]` income (not full POS invoice UI) |
| G Inventory | **FAIL** (non-blocking) | `applyManualStockAdjustment` threw; not in required PASS gate |
| H Payroll | **PASS** | generated=1 wage=200; retry newRows=0 |
| I Targets | **PASS*** | generator ran; eligibleEmployees=0 (no smoke target sales tier hit) |
| J Ledger isolation | **PASS** | smoke artifacts on GLEEM ledger=0; note: hourly ledger dual-write produced 0 PH1GTEST ledger rows in this env |
| K Monthly salary | **PASS*** | dryRun only; eligible=0 for monthly plan |
| L Smoke nightly subset | **PASS** | finalize+payroll BranchID=2 only; idempotent |
| M Reports scope | **PASS** | PhAtt=1 PhPay=1 PhBook=1 GleemHasSmokeAtt=0 |
| External side effects | **PASS** | WhatsApp master off; ExternalSideEffectsEnabled=0; no public exposure; no production printer |
| GLEEM isolation | **PASS** | `smokeArtifactsOnGleem=0` |

\* Marked partial where the controlled substitute was used instead of a full production UI path.

---

## Artifact registry (run 3)

Registered then cleaned (9 artifacts), including:

- TblEmp / assignment / payroll plan  
- TblNewDay  
- TblEmpAttendance  
- Bookings / QueueTickets  
- TblCashMove  
- TblEmpDailyPayroll  

Post-cleanup operational counts on PH1GTEST:

```text
Bookings=0 Queue=0 Attendance=0 Payroll=0 Ledger=0 Targets=0 CashMoves=0 Days=0
Smoke employees=0
Pending artifacts=0
```

Also removed legacy Phase 1G leftover booking/queue on PH1GTEST during post-verify.

---

## GLEEM isolation

```text
Smoke artifacts owned by GLEEM = 0
GLEEM rows referencing smoke entities = 0
No smoke-owned BranchID=1 rows
```

Concurrent GLEEM max-ID growth is allowed; proof is artifact ownership, not frozen totals.

---

## Cleanup

| Action | Result |
|---|---|
| Artifact delete by SmokeRunID + BranchID=2 | Done |
| Refuse GLEEM | Enforced in service/script |
| PH1GTEST → SETUP, IsActive=0, PublicBookingEnabled=0 | **PASS** |
| Smoke run history preserved | Status=`CLEANED` |

---

## Fingerprints

- Before: `scripts/branch-smoke/_phase1m-smoke-before.json`  
- After ops: `scripts/branch-smoke/_phase1m-smoke-after-operations.json`  
- After cleanup: `scripts/branch-smoke/_phase1m-smoke-after-cleanup.json`  

Runner: `scripts/branch-smoke/run-phase1m-controlled-smoke.ts`
