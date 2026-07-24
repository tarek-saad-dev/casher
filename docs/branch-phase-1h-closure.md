# Phase 1H Closure — Secure Active-Branch Session Switching

**Status:** Complete on cloud `last132` (verifier PASSED; unit tests PASSED)  
**Date:** 2026-07-24  
**Database:** cloud / `last132` only  
**Live active branches:** **1** (GLEEM) — unchanged by this phase  
**Sync:** stopped and unused

See also: `branch-phase-1h-switcher-dependency-audit.md`, `branch-phase-1h-session-switch-contract.md`, `branch-phase-1h-cache-and-state-isolation.md`, `branch-phase-1h-verification.md`.

## 1. What Phase 1H is

An **in-session** branch switcher: a user with `CanOperate` access on more than one active branch can switch which branch their session is currently operating, without logging out. This closes the gap Phase 1G's closure explicitly deferred ("no internal branch switcher — to operate another branch a user needs `CanOperate` access **and** that branch as login default").

Phase 1H is purely a **session-cookie feature**. It does not create, activate, or modify any branch; it does not touch `TblUserBranchAccess.IsDefault`; it does not add HR `BranchID`; it does not change public booking. With only one active branch (GLEEM) in production, the switcher currently renders as a label-only display in the UI — its full value is realized once a second branch is actually activated (a decision explicitly deferred to a future phase, same as Phase 1G's closure said).

## 2. Live verification

Verifier run (cloud / `last132`):

| Check | Result |
|---|---|
| Route Handlers + switcher source files present | all present |
| `switch-branch` route uses `switchActiveBranch`, `branches` route uses `listSwitchableBranchesForUser` | confirmed |
| `switchBranch.ts` gates on `CanOperate`, no admin bypass | confirmed |
| `switchBranch.ts` never imports the DB layer / no `SET IsDefault` | confirmed |
| `BranchSwitcher.tsx` / `postSwitchClient.ts` use `performBranchSwitch` / `window.location.assign`, no `useRouter` | confirmed |
| Sensitive-action registry has `BRANCH_SESSION_SWITCH` + `BRANCH_SESSION_SWITCH_DENIED` | confirmed |
| Active branches | **1** (`GLEEM`) |
| `PH1GTEST` | present, **IsActive = 0** (unchanged — not reactivated) |
| Forbidden HR `BranchID` columns | **0** |
| Overall | **Phase 1H verification PASSED** |

**Live smoke:** intentionally **skipped** — see `branch-phase-1h-verification.md` §4. Reactivating `PH1GTEST` to smoke a real switch was explicitly out of scope for this task; the switch/list logic itself is fully exercised by the mocked unit-test suite (22 tests, real `switchActiveBranch`/`listSwitchableBranchesForUser` code paths, doubled DB/cookie I/O only).

## 3. Files

**New (this phase's remaining artifacts)**

* `src/lib/__tests__/phase1hBranchSwitcher.test.ts`
* `scripts/verify-branch-switcher.ts`
* `docs/branch-phase-1h-switcher-dependency-audit.md`
* `docs/branch-phase-1h-session-switch-contract.md`
* `docs/branch-phase-1h-cache-and-state-isolation.md`
* `docs/branch-phase-1h-verification.md`
* `docs/branch-phase-1h-closure.md`

**Already implemented (prior to this task, listed for completeness — see the dependency audit for how each is used)**

* `src/lib/branch/switchBranch.ts`
* `src/lib/branch/postSwitchNavigation.ts`
* `src/lib/branch/postSwitchClient.ts`
* `src/app/api/auth/branches/route.ts`
* `src/app/api/auth/switch-branch/route.ts`
* `src/components/session/BranchSwitcher.tsx`
* `src/lib/sensitiveActionAudit.ts` (`writeSensitiveAuditEvent`)
* `sensitiveActionRegistry.ts` (`BRANCH_SESSION_SWITCH`, `BRANCH_SESSION_SWITCH_DENIED`)
* `src/lib/branch/index.ts` (barrel re-export)
* `ActiveSessionBar.tsx` / `MobilePosHeader.tsx` wiring
* `SessionProvider.tsx` (`activeBranch` exposure)

**Fixed while closing this phase**

* `src/components/session/SessionProvider.tsx` — normalized the PascalCase `/api/auth/session` `activeBranch` payload into the camelCase `SessionActiveBranch` shape the context type promises (latent shape bug, not caught by `tsc` because `res.json()` is `any`; no current consumer was affected). See dependency audit §7.

## 4. Tests

```bash
npx vitest run src/lib/__tests__/phase1hBranchSwitcher.test.ts
```

**Result:** 22 passed (22) — mocked repository/session/access/audit coverage for `listSwitchableBranchesForUser`, pure-function coverage for `resolvePostSwitchNavigationPath`, mocked-DB coverage for `switchActiveBranch` success/denied/idempotent/invalid-input paths, and source-contract assertions for every wiring point called out in the task (routes, `CanOperate` gate, no `IsDefault` mutation, hard-navigation client contract, registry entries, barrel exports).

## 5. Commands run

```bash
npx vitest run src/lib/__tests__/phase1hBranchSwitcher.test.ts
# → 22 passed

npx vitest run \
  src/lib/__tests__/phase1hBranchSwitcher.test.ts \
  src/lib/__tests__/phase1gSecondBranchReadiness.test.ts \
  src/lib/__tests__/phase1fBookingQueueOwnership.test.ts \
  src/lib/__tests__/phase1bSession.test.ts \
  src/lib/__tests__/phase1dFinancialOwnership.test.ts \
  src/lib/__tests__/phase1eReportScope.test.ts
# → 85 passed (6 files)

npx tsx scripts/verify-branch-switcher.ts --mode=cloud --expected-database=last132 --with-phase1g
# → Phase 1H verification PASSED (+ Phase 1G PASSED)

npx eslint <touched Phase 1H sources> --max-warnings=0
# → 0 errors on new switcher sources/tests

npm run build
# → Compiled successfully; TypeScript OK; exit 0
```

## 6. Audit decisions carried into this closure

* **`CanOperate` is the switch permission.** `CanSwitch` (added in Phase 1B) remains schema-present and unused for authorization — documented in `branch-phase-1h-switcher-dependency-audit.md` §3. This was a deliberate choice, not an oversight: introducing a second, never-enforced permission column's semantics now would be scope creep beyond "let a `CanOperate` user switch branches."
* **No new gating, no new tables, no new migration.** Phase 1H is entirely additive at the session-cookie and UI layer; every branch-scoped downstream read (business day, shift, financial ownership, booking/queue ownership, report scope) already resolves from the session cookie and needed zero changes.
* **Hard reload, not soft refresh.** `window.location.assign` is mandatory after a successful switch, specifically to avoid stale branch-scoped client state (see `branch-phase-1h-cache-and-state-isolation.md`). Enforced by both the unit tests and the verifier so it cannot silently regress.

## 7. Limitations

* Still one live branch (GLEEM); the switcher UI is label-only in production until a second branch is activated
* **No** live end-to-end smoke of an actual switch (deliberately skipped — see §2 and `branch-phase-1h-verification.md` §4)
* **No** `CanSwitch` enforcement (by design — see §6)
* **No** HR / payroll / attendance / ledger / targets / budgets `BranchID`
* **No** change to public booking
* `PH1GTEST` remains deactivated, exactly as Phase 1G left it

## 8. Explicit GO / NO-GO

| Decision | Verdict |
|---|---|
| Session-switch **infrastructure** (access rule, cookie reissue, audit trail, non-disclosing errors, hard-reload client contract) | **GO** — unit-tested (22/22) + source-contract + live-verified on `last132`; GLEEM remains the sole active branch, `PH1GTEST` remains inactive, no HR `BranchID` |
| Switching into a **second production branch** end-to-end | **CONDITIONAL** — infra is ready; a live smoke can only run once a real second branch is bootstrapped per Phase 1G's `bootstrap-branch.ts --confirm` process, at which point the disposable-smoke pattern described in `branch-phase-1h-verification.md` §4 should be followed |
| Reactivating `PH1GTEST` for testing | **NO-GO** — explicitly out of scope for this task |

## 9. Next-phase boundary

Do **not** start the next phase from this closure alone without acceptance.

**Still deferred:** HR / payroll / attendance / ledger / targets / budgets (frozen); `CanSwitch` enforcement (schema-present, intentionally unused); a real second production branch (Phase 1G infra is ready; not opened by this phase either).
