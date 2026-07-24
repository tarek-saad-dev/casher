# Phase 1I — Verification

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Scope:** Boundary audit + P0 code corrections (no schema migration)

---

## 1. Live database verification

Captured via `scripts/audit-branches/14-phase1i-live-inventory.cjs` → `_phase1i-live-inventory.json` (2026-07-23T23:50:50Z).

| Check | Result |
|---|---|
| Expected database | `last132` |
| Active branches | **1** — GLEEM (`BranchID=1`, `IsActive=true`) |
| PH1GTEST | Present `BranchID=2`, **IsActive=false** |
| Tables with `BranchID` column | **12** (see database ownership matrix) |
| Bookings / QueueTickets / QueueBookingSettings | 1524 / 140 / 2 rows; all have BranchID (Phase 1F) |
| Forbidden HR BranchID columns added in 1I | **None** — attendance, purchases, ledger remain without BranchID |
| `TblBudget` / `TblOffers` | **Absent** |
| `purchaseHasBranch` | **false** |
| `proHasQty` | **true** (`TblPro.Qty` column live) |
| `attendanceHasBranch` | **false** |
| Sync registry | ~40 tables `IsEnabled=true` in metadata; **service stopped/unused** |

---

## 2. Route ownership markers

Central registry: `src/lib/branch/domainOwnershipRegistry.ts`

`BRANCH_OWNED_ROUTE_MARKERS` documents required patterns for P0 routes corrected in Phase 1I:

| Route file | Required marker |
|---|---|
| `operations/status/route.ts` | `requireActiveBranchContext` |
| `day/rollover-check/route.ts` | `requireActiveBranchContext` |
| `day/history/route.ts` | `BranchID = @branchId` |
| `day/summary/route.ts` | `validateBusinessDayBelongsToBranch` |
| `shift/route.ts` | `getUserOpenShiftForBranch` |
| `shift/history/route.ts` | `BranchID = @branchId` |
| `shift/summary/route.ts` | `validateShiftBelongsToBranch` |
| `shifts/current/route.ts` | `BranchID = @branchId` |
| `business-days/route.ts` | `BranchID = @branchId` |
| `sales/today/route.ts` | `BranchID = @branchId` |
| `queue/settings/route.ts` | `WHERE BranchID = @branchId` |
| `treasury/current/route.ts` | `BranchID = @branchId` (prior phase) |

Manual or scripted verification: confirm each file contains its marker string (source contract check).

---

## 3. Domain ownership registry

`DOMAIN_OWNERSHIP_REGISTRY` lists active domains with classification, roots, `goLiveBlocker` flags.

Blocker domains flagged in registry:

* `inventory_stock`
* `purchases`
* `attendance`
* `payroll_ledger_targets`

Non-blocker deferred: `budgets`, `offers`, `loyalty` (preferred attribution only).

---

## 4. Phase 1G / 1H regression (unchanged infrastructure)

Re-run prior verifiers to confirm branch bootstrap and switcher still valid:

```bash
npx tsx scripts/verify-branch-switcher.ts --mode=cloud --expected-database=last132 --with-phase1g
```

Expected: Phase 1H PASSED; Phase 1G PASSED; GLEEM only active; PH1GTEST inactive; 0 forbidden HR BranchID columns.

---

## 5. Unit test suite (executed results)

```bash
npx vitest run \
  src/lib/__tests__/phase1iMultibranchBoundaries.test.ts \
  src/lib/__tests__/phase1hBranchSwitcher.test.ts \
  src/lib/__tests__/phase1gSecondBranchReadiness.test.ts \
  src/lib/__tests__/phase1fBookingQueueOwnership.test.ts \
  src/lib/__tests__/phase1bSession.test.ts \
  src/lib/__tests__/phase1dFinancialOwnership.test.ts \
  src/lib/__tests__/phase1eReportScope.test.ts
```

**Result (2026-07-24):** 7 files, **93 passed**, exit 0.

```bash
npx tsx scripts/verify-multibranch-boundaries.ts \
  --mode=cloud \
  --expected-database=last132 \
  --with-phase1g \
  --with-phase1h
```

**Result:** Phase 1I verification **PASSED** (CONDITIONAL GO — blockers documented); nested 1G + 1H **PASSED**.

```bash
npm run build
```

**Result:** exit **0**.

Targeted ESLint on rewritten Phase 1I files: **0 errors / 0 warnings**.

Note: `sales/today/route.ts` and `sales/route.ts` retain pre-existing `any` lint debt outside the scope of the branch predicate fix; rewrite set listed in §8 was lint-clean.
---

## 6. What Phase 1I did **not** verify

| Item | Reason |
|---|---|
| Live branch switch into PH1GTEST | Explicitly out of scope — remains inactive |
| End-to-end second branch operations | **NO-GO** until blockers cleared |
| Inventory migration | Not performed |
| HR BranchID migration | Not performed |
| Sync service restart | Forbidden |
| Nightly close per-branch iteration | Documented risk only |

---

## 7. Verification artifacts (this phase)

| Artifact | Path |
|---|---|
| Live inventory JSON | `scripts/audit-branches/_phase1i-live-inventory.json` |
| Live inventory script | `scripts/audit-branches/14-phase1i-live-inventory.cjs` |
| Ownership registry | `src/lib/branch/domainOwnershipRegistry.ts` |
| Feature inventory | `docs/branch-phase-1i-feature-inventory.md` |
| Database matrix | `docs/branch-phase-1i-database-ownership-matrix.md` |
| Shared vs owned contract | `docs/branch-phase-1i-shared-vs-owned-contract.md` |
| Risk register | `docs/branch-phase-1i-risk-register.md` |
| Closure | `docs/branch-phase-1i-closure.md` |

---

## 8. Acceptance criteria for Phase 1I documentation closure

- [x] Live DB facts captured on `last132`  
- [x] P0 route corrections documented with file list  
- [x] Deferred blockers explicitly listed (inventory, attendance, HR, jobs, printers)  
- [x] No claim of GO for activating production branch #2  
- [x] No invented migrations  
- [x] Classification vocabulary used consistently  
