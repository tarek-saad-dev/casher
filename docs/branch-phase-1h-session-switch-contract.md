# Phase 1H — Session Switch Contract

**Status:** Complete  
**Date:** 2026-07-24  
**Modules:** `src/lib/branch/switchBranch.ts`, `src/app/api/auth/switch-branch/route.ts`, `src/app/api/auth/branches/route.ts`

## 1. Endpoints

### `GET /api/auth/branches`

Returns the branches the authenticated user may switch into, plus the current active branch.

```json
{
  "ok": true,
  "activeBranch": { "branchId": 1, "branchCode": "GLEEM", "branchName": "...", "shortName": "..." },
  "branches": [
    { "branchId": 1, "branchCode": "GLEEM", "branchName": "...", "shortName": "...", "isCurrent": true }
  ]
}
```

* 401 `UNAUTHORIZED` / `SESSION_INVALID` if the cookie is missing/invalid (stale cookie is cleared).
* `branches` is produced by `listSwitchableBranchesForUser(userId, currentBranchId)` — see §2.

### `POST /api/auth/switch-branch`

Body: `{ "branchId": number }`.

```json
{ "ok": true, "changed": true, "activeBranch": { "branchId": 2, "branchCode": "BR2", "branchName": "...", "shortName": "..." } }
```

Failure shape: `{ "ok": false, "error": "<CODE>", "message": "<Arabic user-facing message>" }` with the matching HTTP status. The Route Handler does not import `@/lib/session` directly — cookie mutation happens exclusively inside `switchActiveBranch`, which is the single place allowed to call `createSession`.

## 2. Eligibility rule (`listSwitchableBranchesForUser`)

A branch is switchable for a user iff, at read time:

1. The user exists and is **not** soft-deleted (`getUserActiveStatus`) — otherwise throws `USER_DELETED` (401).
2. The user has a `TblUserBranchAccess` row for that branch that is currently valid (`isActive`, within `ValidFrom`/`ValidTo`) — via `listUserValidBranchAccess`.
3. `CanOperate = 1` on that row.
4. The branch itself is active (`branchIsActive`).

Result is sorted with the current branch first, then by `branchCode`. If only one branch qualifies, `BranchSwitcher` renders a label only (no dropdown) — this is a client-side simplification, not a server contract; the server always returns the full switchable list.

## 3. Switch rule (`switchActiveBranch`)

Order of checks, each a distinct failure mode:

| # | Check | Failure | Status | Audited? |
|---|---|---|---|---|
| 1 | Session cookie verifies | `SESSION_INVALID` | 401 | no (no user context to attribute) |
| 2 | `getSession()` resolves a user | `SESSION_INVALID` | 401 | no |
| 3 | User not soft-deleted | `USER_DELETED` | 401 | no |
| 4 | `branchId` is a finite positive number | `INVALID_BRANCH` | 400 | yes (denied) |
| 5a | **Same branch requested** (`branchId === current`) | — idempotent success, `changed: false` — | 200 | **no** (not a state change) |
| 5b | Otherwise: target branch exists and is active | `BRANCH_NOT_FOUND` | 404 | yes (denied) — same code whether missing or inactive, non-disclosing |
| 6 | `validateUserBranchAccess` resolves a row (active, in-range, branch active) | `BRANCH_ACCESS_DENIED` | 403 | yes (denied) |
| 7 | `access.canOperate === true` | `BRANCH_ACCESS_DENIED` | 403 | yes (denied) |
| 8 | `createSession(...)` succeeds | `SESSION_INVALID` | 500 | yes (denied) |
| — | All checks pass | success, `changed: true` | 200 | yes (success) |

Checks 6 and 7 return the **same** `BRANCH_ACCESS_DENIED` / 403 regardless of whether the user has no access row at all, an expired/inactive row, or an active row without `CanOperate` — this is intentional non-disclosure (a user probing branch IDs cannot distinguish "no relationship to this branch" from "has a relationship but insufficient rights").

On any failure the **current session cookie is left untouched** — a failed switch never logs the user out or corrupts their existing active branch.

## 4. Cookie reissue

On success, `createSession` is called with the identity fields copied verbatim from the existing session (`UserID`, `UserName`, `UserLevel`) and only `ActiveBranchID` / `ActiveBranchCode` replaced, plus the current `BRANCH_SESSION_VERSION`. This goes through the exact same `SessionPayload` encode/sign path as login (`src/lib/session.ts`) — no parallel cookie-writing code exists.

## 5. Audit trail

Every switch attempt that reaches a permission or execution decision (checks 4, 5b, 6, 7, 8, and the terminal success) is recorded via `writeSensitiveAuditEvent` (`src/lib/sensitiveActionAudit.ts`) using the registry entries:

* `BRANCH_SESSION_SWITCH` — success. `oldData`/`newData` capture `ActiveBranchID`/`ActiveBranchCode` before and after.
* `BRANCH_SESSION_SWITCH_DENIED` — any denial. `newData` captures the reason code and the requested branch id; `oldData` captures the branch the user was on when they attempted it.

Idempotent same-branch requests (check 5a) are **not** audited — no state changed, so there is nothing to log, consistent with `writeSensitiveAuditEvent` being reserved for actual mutations/denials.

Audit failures are caught and logged to `console.error` but never fail the switch itself (`writeSensitiveAuditEvent` runs after the cookie decision is already made) — consistent with `writeSensitiveAuditEvent`'s "standalone audit write" contract (no DB transaction wraps the cookie mutation).

## 6. What this contract deliberately does not do

* Does not update `TblUserBranchAccess.IsDefault` — the login default branch is unrelated to the session's currently active branch.
* Does not gate on `CanSwitch` — see the dependency audit doc, §3.
* Does not accept or trust any branch/permission data from the request body other than the target `branchId`.
* Does not allow `UserLevel = 'admin'` to bypass `CanOperate`.
