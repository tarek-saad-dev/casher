# DRVO-013 — Authoritative Tenant Runtime Context & Isolation

Issue: #61 · Branch: `drvo-013-authoritative-tenant-context` (stacked on DRVO-012 `2c056a3`) · No schema migration.

## Status

| Gate | Result |
| --- | --- |
| Code + unit/contract tests | done |
| Build | see PR |
| Runtime staging proof (`last132_agent`) | **PENDING** — no staging credentials on the implementation machine |

Staging proof command (staging only; never reads `.env.local`):

```bash
DRVO_STAGING_DB_PASSWORD=... npx tsx scripts/drvo/drvo-013-tenant-isolation-smoke.ts
```

The script hard-stops unless `DB_NAME() = last132_agent` and `SUSER_SNAME() = drvo_agent`, and removes its
`DRVO013_*` tenants before and after the run.

## Canonical TenantContext

`src/platform/tenant/tenantContext.ts` is the only resolver:

- **Staff:** user → `TenantMembership` → active `Tenant` → active `Location` (the session branch).
  `resolveStaffTenantContextForRequest`. Zero memberships → `TENANT_CONTEXT_UNRESOLVED`; several memberships without a
  session tenant → `TENANT_AMBIGUOUS`; a session tenant the user no longer belongs to → `TENANT_MEMBERSHIP_MISMATCH`.
- **Public:** `resolvePublicTenantContext({ branchCode } | { legacyBranchId })` — the branch must map to exactly one
  active Location of an active Tenant.
- **Jobs:** `buildJobTenantContext(row.TenantId, source)` — TenantId always comes from the claimed row.
- **Composition roots:** `requireActorTenantId(actor)` — an actor without a tenant is rejected, never defaulted.

There is no default / first-tenant fallback anywhere in request code. Cross-tenant branch, location and user
failures (`LOCATION_NOT_IN_TENANT`, `USER_NOT_IN_TENANT`) map to the same public 404 as a missing record.

## Session as trust boundary

- `createSession` requires `TenantId` + `MembershipId` (resolved at login / branch switch).
- A cookie without both decodes as `legacy` → re-login (`SESSION_UPGRADE_REQUIRED`). Existing sessions are invalidated
  once on deploy; users simply log in again.
- `authenticate()` re-resolves membership + location against the DB on every call (revocation is immediate) and then
  evaluates the DRVO-012 subscription gate for that tenant.
- `resolveActiveBranchContext` re-verifies the session tenant through `resolveStaffTenantContextForRequest` (membership +
  active Location) and then the DRVO-012 subscription gate (`SUBSCRIPTION_INACTIVE` → 403).
- `TenantContextError.message` is always the non-disclosing public text; internal detail lives in `.detail` (logs only),
  so legacy catch blocks that echo `err.message` cannot leak tenant / user / branch identifiers.
- Legacy routes that only call `getSession()` rely on the signed tenant binding; they gain no per-request DB cost.

## Isolation changes

- **Branch switching / listing:** limited to the session tenant's Locations; a cross-tenant switch is a non-disclosing
  404 audited as `BRANCH_NOT_IN_TENANT`.
- **Users:** `/api/users` lists only tenant members; create goes through `createTenantStaffUser` (TblUser +
  TenantMembership + LegacyIdMap in one transaction, DRVO-012 user limit). `/api/users/[id]` GET/PUT/DELETE answer 404
  for users of another tenant and validate the target branch against the tenant before any write.
- **Branch grants:** `grantStaffAccessToAllActiveBranches` requires `tenantId` and only grants that tenant's branches.
  `listUserBranchAccessRows` / `getUserBranchAccess` only return `TblUserBranchAccess` rows whose branch is a Location
  of a tenant the user is a member of, so stale cross-tenant legacy grants are ignored by every
  `listUserValidBranchAccess` caller.
- **Ops write branch:** `listUserOpsVisibleBranchIds`, `userCanWriteOpsOnBranch`, `resolveOpsWriteBranch` and
  `userCanManageOpsBranchRecord` take the session `tenantId` and refuse branches outside it (queue, bookings,
  available slots, booking packages, internal ops booking).
- **Branch admin:** list filtered by tenant; every handler under `admin/branches/[id]/**` (including the setup routes)
  calls `branchAdminTenantScopeResponse` (static guard). Provisioning (`createBranchForTenant`) runs the DRVO-012 branch
  limit check and creates the Location + LegacyIdMap in one transaction; template branches must belong to the tenant.
- **Financial deletes:** income/expense deletes build the actor from the session tenant and assert the record's branch
  is in that tenant inside the transaction.
- **Public booking:** create / hold / cancel derive the tenant from the branch code, branch id, booking code or hold
  key (`src/lib/booking/publicBookingTenant.ts`). Internal ops calling public routes must target their own tenant.
  Hold release only resolves a hold whose `t:{tenant}:` prefix matches the tenant owning the hold's branch, and fails
  closed if the same client key is active in two tenants. A client echoing the server-returned prefixed key is resolved
  only for the tenant named in that prefix.

## Keys, locks, caches

- **Idempotency:** client keys stored in global tables are namespaced `t:{tenant}:{key}`
  (`namespacedRequestKey`, `namespacedHoldKey`); keys that would exceed 128 chars become `t:{tenant}:h:{sha256}`.
  Namespacing is idempotent (already-prefixed keys get the same length / hash treatment).
  Platform keys use `tenantIdempotencyKey`.
- **Applocks:** `tenantLockResource` lower-cases the tenant (SQL returns upper-case GUIDs; `sp_getapplock` names are
  case-sensitive). Every `sp_getapplock` site is classified in `drvo013StaticGuards.test.ts`:
  tenant-scoped (`tenantApplock`, workforce adapter) or global-by-design (EmpID / BookingCode / LocationId are globally
  unique; `SqlAllocator` and the auto-absence scan operate on legacy global tables).
- **Memoization:** `TenantScopedMemo` has no API without a tenant; DRVO-012 gate memos (`accessGateMemo.ts`) are
  invalidated per tenant after platform mutations.
- **Workers:** `src/platform/outbox/consumer.ts` claims with `UPDLOCK, READPAST`, builds a `JobTenantContext` per row,
  dead-letters rows without a valid TenantId and settles by `(Id, TenantId)`.

## DRVO-012 gates

Commercial and app gates run only after an authoritative tenant exists: `authenticate()` (subscription),
`requireTenantApp` and the booking / queue / pos composition roots (`assertTenantAppInstalled`). Treasury and calendar
remain ungated (DRVO-012 decision). CASHER_BOOT keeps every registry app installed, so its behavior is unchanged.

## Platform operator vs staff

`requirePlatformOperator()` requires `super_admin` **and** membership in the platform-owner tenant, and returns a
`PlatformOperatorAuth` with no tenant / active-branch fields. A tenant admin who is `super_admin` inside their own tenant
is not a platform operator. All `/api/admin/platform/**` routes use it exclusively (static guard).

## CASHER_BOOT seams

`resolveLegacyBootstrapTenantId(seam)` is the only bootstrap-by-code lookup, restricted to named seams:
`platform-operator-tenant`, `legacy-messaging-worker` (TblMessaging* has no TenantId), `casher-boot-staging-smoke`,
`casher-boot-operator-script`. The DRVO-005/006 staging smokes no longer pick "the first active tenant/branch"; they
target CASHER_BOOT by code and its Locations.

## Rollout preflight (mandatory before deploy)

Authoritative context fails closed: a CASHER_BOOT user without a `TenantMembership` cannot log in (403) and is hidden
from `/api/users`; a branch without a `Location` is unreachable. Before deploying, run `verifyPlatformBootstrap`
against the target database and, if it reports `Missing TenantMembership` / missing Location rows, re-run the platform
bootstrap reconcile (`ensurePlatformBootstrapData`, staging first). The DRVO-013 staging smoke runs this check as a
hard preflight before any mutation.

## Known limitations

1. Users with several memberships must carry a session tenant; POS application services without one fail closed
   (`TENANT_AMBIGUOUS`). Login has no tenant selector yet (`TblUser.loginName` is global).
2. `PlatformOutbox` has no lease columns; rows stuck in `delivering` after a crash need manual requeue.
3. The legacy (flag-off) booking path keeps its global keys; it only serves CASHER_BOOT.
4. The public single-branch fallback when `branchCode` is omitted remains (unambiguous by construction).
5. Legacy messaging tables stay CASHER_BOOT-only behind the `legacy-messaging-worker` seam.
6. `createBranchForTenant` inserts the legacy `TblBranch` row through the legacy branch service on its own connection,
   not inside the tenant transaction. If the Location transaction fails, a compensating delete removes the SETUP branch;
   if that delete also fails, the orphan has no Location, so it is unreachable (fail closed) and is logged for manual
   cleanup.
7. Operational route catch blocks still answer tenant-context failures with their generic status (often 500); the body
   is non-disclosing, but the status is not normalized to 403/404 outside `authenticate()` / branch context.

## Tests

- `src/platform/__tests__/drvo013TenantIsolation.test.ts` — two synthetic tenants over a fake SQL layer: resolver,
  cross-tenant branch/user/location, public derivation (branch / booking code / hold key, ambiguity), memo/cache
  isolation, idempotency namespacing, lock scoping, outbox claim/dispatch/settle, per-tenant DRVO-012 gates, seams.
- `src/platform/__tests__/drvo013PlatformOperator.test.ts` — operator vs tenant super_admin.
- `src/platform/__tests__/drvo013StaticGuards.test.ts` — no bootstrap default outside seams, no first-tenant query,
  applock inventory, platform routes, gated composition roots, session binding, tenant scope in every
  `admin/branches/[id]/**` handler.
- `src/lib/__tests__/drvo013CrossTenantRoutes.test.ts` — `/api/users/[id]` cross-tenant read/write denial.
- Updated: session, branch context, branch switcher, security baseline, expense delete, booking path regression,
  DRVO-012 wiring (limits now wired on the authoritative tenant).
