# Phase 1S-R — Authoritative Closure

**Environment:** cloud / last132 · BranchID=3 · `CAMP_CAESAR`  
**Probed:** live DB (do not trust prior markdown). Artifact: `scripts/branch-smoke/_phase1s-r-authoritative-truth.json`

## Live lifecycle (authoritative)

| Field | Value |
|-------|-------|
| LifecycleStatus | **INTERNAL_LIVE** |
| IsActive | **1** |
| PublicBookingEnabled | **0** |
| ExternalNotificationsEnabled | **1** |
| QBS.BookingEnabled | **0** |
| QBS.SalonName | Camp Caesar |
| Hours | 11:00 → 01:30 (overnight) |
| GLEEM | PUBLIC_LIVE, public booking on, unchanged |

## Lifecycle audit (authoritative activation path)

| AuditID | Transition | Actor | When (UTC) | Reason |
|---------|------------|-------|------------|--------|
| 22 | SETUP → SMOKE_TEST | 10 | 2026-07-26T21:40:35Z | مرحلة smoke قبل التشغيل الداخلي… |
| 23 | SMOKE_TEST → INTERNAL_LIVE | 10 | 2026-07-26T21:41:27Z | فتح فرع كامب شيزار… (smokeRunId **18** at transition time) |

> SmokeRun **18** was used at transition but is **retained-only** (copied from SmokeRun 13). Authoritative **final current-config** smoke is **SmokeRun 22** (Phase 1S-R).

## Opening / partners

- Opening cash **ZERO** @ 2026-07-27
- Opening inventory **ZERO_STOCK** (approved)
- InternalLiveEffectiveDate **2026-07-27**
- Partners active **40/20/20/20** (عايدة/طارق/ذياد/عمر) EffectiveFrom 2026-07-27
- SharedPrinterApproved / SharedWhatsAppApproved = true

## Real roster

- EmpID **12** زياد — Friday only 11:00→01:30 · hourly **27.2727** · **NO_TARGET** · CanReceiveBookings=1 · services notes present
- No other real active CC assignments (smoke leftovers deactivated)

## Service catalog

- Active priced rows ~42 · bookable timed non-product ~**30** · soft-deleted ~13
- Not Dry-Hair-only; Restore action available in admin services UI
- GLEEM/CC share global `TblPro` catalog

## Smokes

| Run | Role | Status | Verdict |
|-----|------|--------|---------|
| **16** | Phase 1R live transfer (disposable emp) | CLEANED | **GO** — live apply/cancel proofs |
| **18** | Labeled “final” at activation | CLEANED | **NO-GO as final** — `retainedFromSmokeRunId=13` |
| **22** | Phase 1S-R final current-config | CLEANED | **GO** — live ops + `final.current_config` |

## Post-activation

- `listActiveBranches` includes CAMP_CAESAR (+ GLEEM)
- Public list = GLEEM only
- Nightly uses `listActiveBranches` → includes CC
- Public booking remains rejected

## Verdicts

| Gate | Verdict |
|------|---------|
| Database activation INTERNAL_LIVE | **GO** |
| Phase 1R live transfer (16) | **GO** |
| Final current-config smoke (22) | **GO** |
| Service catalog completeness | **GO** |
| Weekly employee coverage | **NO-GO** — Fri only; Sun–Thu+Sat open with zero staff |
| Documentation consistency | **GO** (this Phase 1S-R regen) |
| INTERNAL_LIVE operational readiness | **NO-GO** (weekly coverage business blocker) |
| PUBLIC_LIVE | **NO-GO** |

## Remaining business blockers

1. **`ops.weekly_employee_coverage`** — assign CanOperate staff for uncovered open days **or** mark those weekdays closed. Do not invent employees.
2. Public frontend / booking multi-branch work (blocks PUBLIC_LIVE only).
