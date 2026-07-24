# Phase 1H — Verification

**Status:** Implemented and verified (unit tests + source-contract + live cloud checks)  
**Date:** 2026-07-24  
**Database:** cloud `last132` (read-only checks only — no live smoke switch; see §4)

## 1. Unit tests

```bash
npx vitest run src/lib/__tests__/phase1hBranchSwitcher.test.ts
```

**Result:** 22 passed (22).

Coverage:

| Group | What's covered |
|---|---|
| `listSwitchableBranchesForUser` (mocked repository) | Filters to `CanOperate=1` + branch active; excludes an inactive branch even with `CanOperate=1`; excludes a row with `CanOperate=0`; marks the current branch and sorts it first; throws `USER_DELETED` (401) for a soft-deleted user |
| `resolvePostSwitchNavigationPath` (pure function, no mocks) | Redirects all seven known entity-detail patterns to `/`; keeps `/income/pos`, `/operations`, `/queue` unchanged; strips query strings; defaults null/undefined/empty to `/` |
| `switchActiveBranch` (mocked `@/lib/session`, `@/lib/branch/repository`, `@/lib/branch/access`, `@/lib/sensitiveActionAudit` — no real cookie APIs) | Success path reissues the cookie + audits `BRANCH_SESSION_SWITCH`; `CanOperate=false` denies with 403 and never calls `createSession`, audits `BRANCH_SESSION_SWITCH_DENIED`; no access row at all denies the same way (non-disclosing); unknown and inactive target branch both return the same 404 `BRANCH_NOT_FOUND`; same-branch request is idempotent (`changed:false`, no cookie reissue, no audit write); invalid/missing cookie returns 401 without touching the DB; soft-deleted user is rejected even with a valid cookie; non-finite/non-positive `branchId` returns 400 |
| Source contracts | Both Route Handlers exist and call the `switchBranch` module functions; `switchBranch.ts` gates on `access.canOperate` with no admin bypass; `switchBranch.ts` never imports the DB layer directly (so it cannot issue any SQL, including an `IsDefault` update); `switchBranch.ts` reissues via `createSession` and audits via `writeSensitiveAuditEvent`; `BranchSwitcher.tsx` uses `performBranchSwitch`; `postSwitchClient.ts` hard-navigates via `window.location.assign`; neither client file imports `useRouter`; the sensitive-action registry has both `BRANCH_SESSION_SWITCH` entries; the `branch/index.ts` barrel re-exports the switcher API |

Mocking approach avoids the flaky-cookie-API trap called out in the task: `@/lib/session` is mocked wholesale (no `next/headers` `cookies()` involved), so `switchActiveBranch` tests exercise real business logic against fully deterministic session/DB doubles.

## 2. Verifier script

```bash
# Source contracts only (no DB credentials needed)
npx tsx scripts/verify-branch-switcher.ts --skip-live

# Full run against cloud last132
npx tsx scripts/verify-branch-switcher.ts --mode=cloud --expected-database=last132

# Full run + spawn the Phase 1G verifier in the same pass
npx tsx scripts/verify-branch-switcher.ts --mode=cloud --expected-database=last132 --with-phase1g
```

**Live result (2026-07-24, `last132`):**

```
Phase 1H branch-switcher verifier
  --- source contracts ---
  file exists: src/app/api/auth/switch-branch/route.ts -> true
  file exists: src/app/api/auth/branches/route.ts -> true
  file exists: src/lib/branch/switchBranch.ts -> true
  file exists: src/lib/branch/postSwitchNavigation.ts -> true
  file exists: src/lib/branch/postSwitchClient.ts -> true
  file exists: src/components/session/BranchSwitcher.tsx -> true
  --- live checks ---
  selected mode: cloud
  database: last132
  active branches: GLEEM
  PH1GTEST IsActive: false
  HR tables without BranchID: confirmed
Phase 1H verification PASSED
```

With `--with-phase1g`, the Phase 1G verifier (`verify-second-branch-readiness.ts`) is spawned as a subprocess and its own `Phase 1G verification PASSED` output is inlined; a non-zero exit from it fails the Phase 1H run too.

**Checks performed:**

| Check | Kind | Fails when |
|---|---|---|
| Both Route Handlers + `switchBranch`/`postSwitchNavigation`/`postSwitchClient`/`BranchSwitcher` files exist | source | any is missing |
| Routes call `switchActiveBranch()` / `listSwitchableBranchesForUser()` | source | route doesn't wire the corresponding function |
| `switch-branch` route doesn't import `@/lib/session` directly | source | cookie mutation would bypass the single mutation point |
| `switchBranch.ts` gates on `access.canOperate`, no admin bypass | source | gate missing or bypassed |
| `switchBranch.ts` never imports the DB layer / never contains `SET IsDefault` | source | direct SQL access or an `IsDefault` mutation appears |
| `switchBranch.ts` calls `createSession` + `writeSensitiveAuditEvent` | source | either call is missing |
| `BranchSwitcher.tsx` uses `performBranchSwitch`, doesn't import `useRouter` | source | soft-refresh pattern reappears |
| `postSwitchClient.ts` uses `window.location.assign`, doesn't import `useRouter` | source | hard-navigation contract broken |
| Sensitive-action registry has both `BRANCH_SESSION_SWITCH` entries | source | either registry entry is missing |
| `branch/index.ts` re-exports the switcher API | source | barrel export missing |
| Exactly one active branch and it is `GLEEM` | live | a second branch is activated, or GLEEM is deactivated |
| `PH1GTEST` is not active (if present) | live | `PH1GTEST` gets reactivated |
| No `BranchID` column on `TblEmpAttendance`/`TblEmpPayroll`/`TblEmpTarget`/`TblEmpLedgerEntry`/`TblBudget` | live | any forbidden HR table gains `BranchID` |

## 3. TypeScript

`npx tsc --noEmit` was run against the full project. All pre-existing errors are unrelated to Phase 1H (attendance/break-schedule sync test typing, an unrelated `smoke-second-branch-ops.ts` field, an unrelated integration test signature) — none touch `switchBranch.ts`, `postSwitchNavigation.ts`, `postSwitchClient.ts`, `BranchSwitcher.tsx`, `SessionProvider.tsx`, or `branch/index.ts`.

One latent (non-compiler-caught) shape bug was found and fixed while auditing: `SessionProvider.tsx` was assigning `/api/auth/session`'s PascalCase `activeBranch` payload (`BranchID`, `BranchCode`, ...) directly into a field typed as the camelCase `SessionActiveBranch` shape. `res.json()` returns `any`, so `tsc` did not flag it; no current consumer read `useSession().activeBranch` yet, so it was latent rather than a live defect. Fixed by normalizing the mapping in `SessionProvider.refresh()`. See `branch-phase-1h-switcher-dependency-audit.md` §7.

## 4. Live smoke — intentionally skipped

Phase 1H does **not** run a live end-to-end smoke switch (log in, call `switch-branch`, confirm a reissued cookie against a second live branch). This is a deliberate scope decision, not an oversight:

* The only way to smoke-test an actual *switch* end-to-end is to have a second **active** branch to switch into. `PH1GTEST` was intentionally deactivated at the end of Phase 1G and this task explicitly prohibits reactivating it.
* Reactivating any branch — even temporarily — changes the live "GLEEM is the only active branch" invariant that Phase 1G closed on and that this verifier now also asserts. That is a bigger blast radius than Phase 1H's actual change (a session-cookie feature with a full unit-test + mocked-DB suite already covering every branch of `switchActiveBranch`'s logic).
* The infrastructure that a live smoke would exercise (`CanOperate` gate, non-disclosing 404/403, cookie reissue shape, audit rows) is already exercised by the mocked unit tests in §1, which drive the *real* `switchActiveBranch`/`listSwitchableBranchesForUser` functions — only the DB and cookie I/O are doubled.

**If a temporary smoke is needed later:** follow the same disposable-branch pattern as Phase 1G's `smoke-second-branch-ops.ts` (Part 13 of that phase) — bootstrap a throwaway branch, grant one user `CanOperate`, exercise `GET /api/auth/branches` → `POST /api/auth/switch-branch` → confirm the reissued cookie's `ActiveBranchID`, then deactivate the branch and its grants again, exactly as `13-deactivate-ph1gtest-assignments.cjs` did. This was not run for Phase 1H closure.
