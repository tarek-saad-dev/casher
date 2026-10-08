# DRVO-015 — Shared Master-Data Tenancy

Branch: `drvo-015-master-data-tenancy` (stacked on DRVO-013 `b8e191b`) · Migration **10** `master-data-tenancy`.

## Status

| Gate | Result |
| --- | --- |
| Code + unit/contract/isolation tests | done |
| Build | see PR |
| Migration 10 applied on staging (`last132_agent`) | **PENDING** — no staging credentials on the implementation machine |
| Runtime staging proof | **PENDING** — `npm run drvo-015:smoke` after migration 10 is applied on staging |

Production is untouched. Migration 10 is `HIGH` risk and `requiresBackup`; it must not run on production without an
approved backup and an explicit go.

Staging commands (staging only; neither reads `.env.local`, both hard-stop unless `DB_NAME() = last132_agent` and
`SUSER_SNAME() = drvo_agent`):

```bash
DRVO_STAGING_DB_PASSWORD=... npm run drvo:migrate          # applies migration 10 on staging
DRVO_STAGING_DB_PASSWORD=... npm run drvo-015:verify       # read-only: schema verify, NULL TenantId, owners per tenant
DRVO_STAGING_DB_PASSWORD=... npm run drvo-015:smoke        # two-tenant proof + CUT backfill proof, full cleanup
```

## Migration 10

`db/drvo-migrations/010-master-data-tenancy/schema.sql`, one transactional batch, checksum is LF-canonical
(`228bfbad49e6101fc3ea04998751d784921ad0d32c5242b9754d3fc059adb428`), no legacy checksums.

| Table | TenantId backfill |
| --- | --- |
| `TblClient`, `TblPro`, `TblCat`, `TblServicePackage`, `TblPaymentMethods`, `TblExpINCat` | all pre-existing rows are CUT data → `CASHER_BOOT` |
| `TblServicePackageItem` | tenant of its parent package |
| `TblEmp` (column + backfill only) | tenant of the Locations its branch assignments map to, else `CASHER_BOOT`; an employee assigned to branches of two tenants aborts the migration |

Order: nullable column → backfill (only `WHERE TenantId IS NULL`, never reassigns) → NULL-count gate (`THROW 51017`)
→ `NOT NULL` → trusted `FK_<table>_Tenant` → `UX_<table>_Tenant_<id>` uniques → composite
`FK_TblServicePackageItem_Package_Tenant (TenantId, PackageID)` → lookup indexes (`IX_TblPro_Tenant_CatID`,
`IX_TblServicePackage_Tenant_Kind_Active`, `IX_TblExpINCat_Tenant_Type`, conditional `IX_TblClient_Tenant_Mobile`).
Exactly one `CASHER_BOOT` tenant is required (`THROW 51015`).

- No `DEFAULT` on `TenantId`: an unscoped insert fails (`515`) instead of silently landing in a tenant.
- No natural-key uniques: two tenants may hold a same-named customer, service, category or package.
- The package tables are now created by the migration (they were created lazily at runtime);
  `ensureServicePackages` only checks that the `TenantId` column exists.
- Rollback is forward-fix: pre-DRVO-015 code inserts master data without `TenantId` and fails against `NOT NULL`, so an
  app-only rollback needs either the approved backup or relaxing `TenantId` to `NULL` under explicit approval.

Verification: `verifyMasterDataTenancySchema` (column type/nullability, trusted FKs, uniques, indexes, zero NULLs, no
cross-tenant package item or service→category reference, exactly one `CASHER_BOOT`) and
`verifyNoNullMasterDataTenant`. Readiness check `platform.master-data`; module manifest `platform-master-data`.

## Tenant source per call site

- **Staff routes:** `authenticate()` / `requirePageAccess()` → `auth.tenantId` (DRVO-013 authoritative).
- **Legacy `getSession()` routes:** the signed `session.TenantId`; a session without it is rejected.
- **Branch-scoped services (HR ledger, deductions, payroll post-to-cash, treasury updates):**
  `tenantIdForBranchContext(branch)` — the DRVO-013 branch stamp, else `resolveLegacyBranchTenantId(branchId)`
  (exactly one active Location of an active Tenant; unmapped or ambiguous → fail closed).
- **Anonymous catalog / client website:** `resolvePublicCatalogTenantId` — the public branch (branchCode or the
  single-public-branch compatibility rule) → its tenant; no tenant → not-found.
- **Messaging worker customer lookup:** the named `legacy-messaging-worker` CASHER_BOOT seam (messaging is not owned
  here). DRVO-018 replaces that seam with a tenant client directory; whichever lands second reconciles it.
- **Platform-operator maintenance (`seed-service-image-paths`):** the operator gate stays (DRVO-013); the target is the
  operator's own tenant via the `platform-operator-tenant` seam (CASHER_BOOT).

`requireMasterDataTenantId` rejects a missing or malformed tenant before any SQL runs. There is no default tenant.

## Scoped surface

Repositories / libs: `servicePackages`, `publicPackagesCatalog`, `serviceCatalog`, `serviceExecutionSteps`,
`tenantCatalogGuards` (`isTenantCategory`, `findForeignServiceIds`), `publicClientWebsite.service`,
`clientPhoneLookup`, `publicBookingHelpers.upsertCustomer`, scheduling/queue customer bridges,
`operationsQueueCreateCore` (a supplied `clientId` must belong to the tenant), customers/catalog legacy adapters,
`ensureTenantFinanceCategory`, `seedTenantMasterData`, treasury `createIncome`/`createExpense`/transfer,
income/expense category updates, HR ledger payout/funding/tip/dues category helpers, `employee-hr-advance`,
`employee-hr-db` (TblEmp insert).

Routes: customers (list/create/update/history), services (list/create/update/delete/restore/categories/reorder/
barber-durations/steps), packages (list/get/create/update/delete/restore), POS packages / groom packages, sales
(line services must be the tenant's), finance categories, payment methods, income meta, expense categories, loyalty
clients / client, POS client inventory, customer follow-up, public catalog, public client packages, client website
lookup/update, operations booking packages, employees POST, deductions, payroll post-to-cash, auto revenue map, admin
seed / Arabic-name maintenance routes.

By-id reads and writes add `AND TenantId = @tenantId`; a row of another tenant is indistinguishable from a missing
row (404 / not-found). References are checked too: a service cannot be filed under another tenant's category, a
package cannot contain another tenant's service (`PackageItemServiceNotFoundError` → 404), a sale line cannot use
another tenant's service, a queue entry cannot attach another tenant's client.

Joins from transactional rows to master data by surrogate id stay tenant-consistent (the referenced row was created
in the same tenant); the joins this branch touched also add `x.TenantId = y.TenantId`.

## New tenants

`provisionTenant` calls `seedTenantMasterData(tx, tenantId)` inside its transaction (no other onboarding change):
payment methods `كاش`, `فيزا`; finance categories `مصروفات عامة` (expenses), `إيرادات أخرى` (income); service category
`خدمات`. Insert-only and idempotent per tenant; never copies CUT customers, services or prices.

## Tests

- `scripts/drvo/__tests__/drvo015Migration.test.ts` — manifest entry, canonical checksum, additive-only SQL, NULL gate,
  FKs/uniques/indexes, no natural-key unique, no DEFAULT, `verifyNoNullMasterDataTenant`, `verifyMasterDataTenancySchema`.
- `src/platform/__tests__/drvo015MasterDataIsolation.test.ts` — two tenants through the real routes/repositories on an
  in-memory SQL engine that honours every WHERE predicate (with a control test proving an unscoped query leaks).
- `src/platform/__tests__/drvo015SeedMasterData.test.ts` — minimal, idempotent, never copies CUT data.
- `src/platform/__tests__/drvo015StaticGuards.test.ts` — every master-data INSERT in `src` names `TenantId`; scoped
  repositories keep their predicates; provisioning seeds only through `seedTenantMasterData`.

## Follow-ups / not owned here

- **Public booking reads** (`publicBookingServices`, package booking resolution) — public booking is not owned by
  DRVO-015; they still read the catalog by id/global list. Their inserts go through the scoped customer upsert.
- **Messaging** audience / knowledge bootstrap queries are unscoped (CASHER_BOOT seam).
- **HR reads of `TblEmp`** (employee lists, payroll, attendance) are not tenant-filtered; DRVO-015 owns the column only.
- **Split-payment clearing settings** (`TblSettingValues` → clearing payment method / categories) are global and point
  at CASHER_BOOT rows; a second tenant needs its own settings model before split payments.
- **Global maintenance:** `ensureCategorySortOrder` one-time `SortOrder` backfill matches categories by name across
  tenants (only rows with `SortOrder = 0`).
- **Anonymous loyalty redeem** (`/api/public/client/loyalty/...`) addresses a client by id without a tenant.
- **Operator scripts** that insert master data without `TenantId` (`scripts/branch-smoke/*`, `ensure-groom-*`,
  `seed-groom-packages`, `verify-temporary-transfer-booking-authority`) now fail closed on `NOT NULL`; the DRVO-008 and
  DRVO-010 staging smokes were updated to stamp `CASHER_BOOT`.
- Tenants provisioned before DRVO-015 (other than `CASHER_BOOT`) have no master data until seeded.
- Report queries that join master data by surrogate id were not individually rewritten.
