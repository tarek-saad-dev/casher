# DRVO-016 — HR, Attendance, Payroll and Employee-Ledger Tenancy

Branch: `drvo-016-hr-payroll-tenancy` (stacked on `9e15bad`) · **No migration** (uses the `TblEmp.TenantId` column
added by DRVO-015 migration 10).

## Status

| Gate | Result |
| --- | --- |
| Code + unit/isolation/static-guard tests | done |
| Build | see PR |
| Runtime staging proof | **PENDING** — `npm run drvo-016:smoke` on staging (`last132_agent`) |

Production is untouched. The smoke hard-stops unless `DB_NAME() = last132_agent` and `SUSER_SNAME() = drvo_agent`:

```bash
DRVO_STAGING_DB_PASSWORD=... npm run drvo-016:smoke
```

It provisions two throw-away tenants, and for each one creates an employee, records attendance, runs daily payroll
and makes an employee-ledger payout. It then proves neither tenant can see, assert, pay or summarise the other's
employee, cleans everything up, and checks the CASHER_BOOT employee count is unchanged.

## Tenant source

Route gates are unchanged (DRVO-013). The HR/payroll services take the gate's `auth.tenantId`, or the tenant of the
branch being worked on, and never a default:

- `requireHrTenantId` rejects a missing or malformed tenant before any SQL runs.
- **Tenant-scoped reads** (employee lists, ledger, monthly reports, wage audit, accounting employee aliases) use
  `TblEmp.TenantId = @tenantId`.
- **Branch-scoped work** (attendance, daily payroll, targets, nightly close, gap review) uses
  `TblEmp.TenantId IN (SELECT TenantId FROM dbo.Location WHERE LegacyBranchId = @branchId)`.
- **Lookups by employee id** (`assertEmployeeInTenant`, `filterEmployeeIdsInTenant`): an employee of another tenant is
  indistinguishable from a missing one (404 / `الموظف غير موجود`).
- **Nightly close** runs once per tenant through `runTenantJobFanout`. `runNightlyClose` requires `tenantId`.

Helpers live in `src/lib/hr/hrTenantScope.ts`. `drvo016StaticGuards.test.ts` fails if a `TblEmp` SQL template literal in an
owned file does not mention `TenantId`. The only exception is the schema-maintenance WhatsApp backfill, which is pinned.

## CUT compatibility design

Every CUT branch-code assumption now lives in `src/lib/hr/legacyHrBranchPolicy.ts`. Branch codes are globally unique,
so none of this can apply to another tenant:

- **Labels:** `GLEEM` → `جليم` and `CAMP_CAESAR` → `كامب شيزار` keep their labels. Other branches show their name.
- **"All employees" scope:** if a tenant has `GLEEM` or `CAMP_CAESAR`, the scope stays those two salons, as it does
  today. Other tenants get all of their viewable branches.
- **Legacy `TblEmpWorkSchedule` fallback:** applies only to the `GLEEM` branch.
- **`employeeScope` alias:** `CAMP` still maps to `CAMP_CAESAR`.
- **UI tabs** come from the API's `scopeOptions` / `branchOptions`, i.e. the tenant's own branches ordered by branch id.
- **Badge colours** are assigned by index (`src/lib/hr/hrBranchUi.ts`). The first two colours match CUT's existing ones
  (attendance/payroll: sky, amber; ledger: sky, violet; branch schedule: amber, sky).
- **Nightly close date:** each tenant closes "yesterday" in the `TblBranch.TimeZone` of its branches. If none is set or
  it is invalid, the time zone is `Africa/Cairo`, as before.
- **Service-ID config:** `src/lib/services/tenantServiceCatalogConfig.ts` is a typed catalog.
  - `CASHER_BOOT` keeps hair `[1,4,5]`, hair+beard `[3]`, beard `[2]` and quick-queue service `9`.
  - Other tenants get an empty catalog, so every service counts as "other".
  - `resolveTenantServiceCatalog(tenantId)` picks the catalog by tenant code.

## Removed

The Youssef one-off fill:

- `src/app/api/dev/youssef-mohamed-fill/route.ts`
- `src/lib/hr/opsFillYoussefMohamedGleemAugust.ts`
- `scripts/_fill-youssef-mohamed-gleem-aug.ts`

## Tests

- `src/lib/__tests__/drvo016HrPayrollTenancy.test.ts` runs two tenants on an in-memory SQL engine that honours the
  `TblEmp` tenant predicates. It covers:
  - the employees route
  - tenant helpers
  - attendance employee lookup
  - ledger payout
  - wage audit binding
  - branch policy, palette and service catalog
- `src/lib/__tests__/drvo016StaticGuards.test.ts` checks:
  - every `TblEmp` SQL literal in the owned HR / payroll / ledger files names `TenantId`
  - no `GLEEM` / `CAMP_CAESAR` literals outside the policy module in HR / payroll code and UI
  - HR tabs come from the tenant branch list
  - the Youssef code is gone and nothing references it

## Follow-ups / not owned here

- **Quick queue:** `operationsQueueCreateCore` still reads the quick-queue service id from `quickQueueConfig`, which
  defaults to the CASHER_BOOT value. Per-tenant wiring belongs to the queue owner.
- **Accounting:** `cashMoveClassificationAudit` loads the employee-alias classification without a tenant (accounting
  is out of scope).
- **Booking / public booking / timeline:** these files still resolve barbers by their own rules.
