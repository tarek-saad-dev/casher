# Phase 1B Session & Branch Context

**Date:** 2026-07-22

## Signed cookie payload (`BranchSessionVersion = 1`)

```ts
{
  UserID: number;
  UserName: string;
  UserLevel: string;
  ActiveBranchID: number;
  ActiveBranchCode: string;
  BranchSessionVersion: 1;
  iat: number;
}
```

Branch capabilities are **not** trusted from the cookie. Every protected resolution revalidates against the database.

## Login

After credentials succeed (`ISNULL(isDeleted,0)=0`):

1. Resolve valid branch mappings
2. Require exactly one valid default branch on an active branch
3. Sign session with branch claims
4. Return backward-compatible login fields plus active-branch metadata and authoritative `roles` / `allowedPagePaths`

Rejects: deleted user, no mapping, inactive/expired mapping, inactive default branch, multiple defaults.

## Legacy cookies

Cookies without `ActiveBranchID` / `ActiveBranchCode` / `BranchSessionVersion = 1` require re-login. No silent GLEEM assignment.

## Soft-delete

`authenticate`, `/api/auth/session`, and active-branch context re-check `ISNULL(TblUser.isDeleted,0)=0`. Soft-deleted users lose access immediately; cookie is cleared when possible.

## Permissions source

`/api/auth/session` uses `getUserAccess` (DB RBAC). Legacy permission strings remain in the `permissions` array for client compatibility, derived from authoritative admin/partner status plus `allowedPageKeys`.

Proxy remains cookie-presence defense only. No branch authorization in the edge matcher.

## Server helpers

Module: `src/lib/branch/`

* Repositories: `getBranchById/Code`, `listActiveBranches`, user access + employee assignment queries
* Access: `validateUserBranchAccess`, `resolveLoginDefaultBranch`
* Context: `getActiveBranchContext`, `requireActiveBranchContext`, `requireBranchOperationAccess`, `requireBranchReportAccess`, `validateSessionBranch`

Request-level memoization only; no cross-request auth cache; no hidden GLEEM fallback in general repositories.

## Read-only APIs

* `GET /api/branches/available`
* `GET /api/branches/active`

No `POST /api/branches/switch`. No branch switcher UI.
