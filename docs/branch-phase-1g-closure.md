# Phase 1G Closure — Second-Branch Operational Readiness

**Status:** Complete on cloud `last132` (uniqueness migration applied; verifier PASSED)  
**Date:** 2026-07-24  
**Database:** cloud / `last132` only  
**Founding branch:** GLEEM (`BranchCode = N'GLEEM'`) → BranchID **1**  
**Live active branches:** **1** (GLEEM only)  
**Sync:** stopped and unused

See also: `branch-phase-1g-operational-readiness.md`, `branch-phase-1g-bootstrap.md`, `branch-phase-1g-validation.md`.

## 1. Live verification

Verifier run (cloud / `last132`):

| Check | Result |
|---|---|
| Uniqueness indexes | `UQ_TblBranch_BranchCode`, `UQ_TblBranch_BranchName`, `UX_TblBranch_ShortName_NotNull` present |
| Active branches | **1** (`GLEEM`) |
| Assignment integrity | **errors=0**, warnings=0 |
| `readiness[GLEEM]` | **ready=true** (blockers none, warnings none) |
| Prior BranchID schema / booking FKs | Present |
| Forbidden HR BranchID columns | **0** |
| Overall | **Phase 1G verification PASSED** |

**Disposable smoke (ran):** `scripts/smoke-second-branch-ops.ts` bootstrapped **`PH1GTEST`** (BranchID 2): settings + partner shares + operator grant + emp assignment → readiness `ready=true` → open business day → booking + queue ticket on BranchID 2 → GLEEM fingerprints unchanged → branch + assignment deactivated. Artifacts retained for audit; **not** a production second branch.

Convert / treasury / reports via POS session for branch #2 remain **CONDITIONAL** until a real branch is bootstrapped and an operator’s session can target it (switcher still deferred — use login default branch access or a future switch API).

## 2. Files

**New**

* `db/migrations/add-second-branch-readiness.sql`
* `scripts/run-second-branch-readiness-migration.ts`
* `scripts/verify-second-branch-readiness.ts`
* `scripts/bootstrap-branch.ts`
* `scripts/smoke-second-branch-ops.ts`
* `scripts/audit-branches/11-phase1g-live-probe.cjs`
* `scripts/audit-branches/12-phase1g-smoke-ids.cjs`
* `src/lib/branch/bootstrap.ts`
* `src/lib/branch/assignmentIntegrity.ts`
* `src/lib/branch/readiness.ts`
* `src/lib/__tests__/phase1gSecondBranchReadiness.test.ts`
* `docs/branch-phase-1g-operational-readiness.md`
* `docs/branch-phase-1g-bootstrap.md`
* `docs/branch-phase-1g-validation.md`
* `docs/branch-phase-1g-closure.md`

**Changed (wiring / unscoped settings / exports)**

* `src/lib/branch/index.ts` — export bootstrap / assignment / readiness APIs
* `src/app/api/admin/booking-settings/route.ts` — branch-scoped settings
* `src/app/api/queue/route.ts` — settings by `BranchID`
* `src/app/api/operations/bookings/[id]/arrive/route.ts` — settings by booking branch
* `src/app/api/services/[id]/barber-durations/route.ts` — per-active-branch timing defaults
* Related session/login touchpoints as needed for branch access contracts (no switcher UI)

## 3. Tests

```bash
npx vitest run src/lib/__tests__/phase1gSecondBranchReadiness.test.ts
```

**Result:** 18 passed (18) — mocked DB / source-contract coverage for identity checks, `grantUserBranchAccess`, readiness not-found shape, assignment integrity, migration/scripts contracts, unscoped-settings fix assertions.

## 4. Commands run

```bash
npx tsx scripts/run-second-branch-readiness-migration.ts \
  --mode=cloud --expected-database=last132 --confirm-maintenance

npx tsx scripts/verify-second-branch-readiness.ts \
  --mode=cloud --expected-database=last132

npx vitest run src/lib/__tests__/phase1gSecondBranchReadiness.test.ts

# Optional dry-run only (no second branch created unless --confirm):
npx tsx scripts/bootstrap-branch.ts \
  --branch-code=... --branch-name=... --readiness
```

## 5. Limitations

* Still one live branch (GLEEM); **no** second branch in production yet  
* **No** internal branch switcher — to operate another branch a user needs `CanOperate` access **and** that branch as login default (or a future switch)  
* **No** HR / payroll / attendance / ledger / targets / budgets BranchID  
* **No** service price overrides; **no** hybrid schedules/day-off/overrides per branch  
* Calendar import remains inactive / unsafe until redesigned  
* Creating branch #2 is still a **deliberate human act** via `bootstrap-branch.ts --confirm` (plus grant-user + assign-emp + readiness), not casual enablement  

## 6. Explicit GO / NO-GO

| Decision | Verdict |
|---|---|
| Operational readiness **infrastructure** | **GO** — migration + helpers + verifier + tests on `last132`; GLEEM `ready=true`, assignment errors=0 |
| Opening **branch #2** in production | **CONDITIONAL GO** — only after `bootstrap-branch.ts --confirm` with `--grant-user-id` + `--assign-emp-id`, readiness report `ready=true`, and business acceptance of ops smoke on that branch |
| Casually enabling a second branch without the above | **NO-GO** |

## 7. Next-phase boundary

Do **not** start the next phase from this closure alone without acceptance.

**Still deferred:** HR / payroll / attendance / ledger / targets / budgets (frozen).

**Optional next (pick by need):**

* Internal **branch switcher** (session switch with `CanSwitch` / access checks), **or**
* **Hybrid** employee schedule / day-off per branch — only if multi-hour-per-branch is required

Neither is started by Phase 1G.
