#!/usr/bin/env npx tsx
/**
 * DRVO-015 staging smoke — last132_agent / drvo_agent only.
 *
 * Proves migration 10 against the real schema:
 *   - migration verify + zero NULL TenantId on every master-data table;
 *   - CUT backfill: pre-existing master data is owned by CASHER_BOOT;
 *   - the database itself refuses a master-data row without TenantId and a package item that
 *     crosses tenants;
 *   - two synthetic tenants get the minimal default seed and hold a same-named customer,
 *     service category, service and package without seeing or updating each other's rows;
 *   - full cleanup, CASHER_BOOT counts unchanged.
 *
 * Never loads .env.local (it may point at production). Requires DRVO_STAGING_DB_PASSWORD.
 */
import Module from 'module';

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, parent, isMain);
};

import sql from 'mssql';

const STAGING_DB = 'last132_agent';
const STAGING_LOGIN = 'drvo_agent';
const PRODUCTION_DB = 'last132';

const SMOKE_TENANTS = [
  { code: 'DRVO015_A', branch: 'DRVO015_ABR', login: 'drvo015_a_owner' },
  { code: 'DRVO015_B', branch: 'DRVO015_BBR', login: 'drvo015_b_owner' },
] as const;

const SHARED = { customer: 'DRVO015 Ahmed Ali', phone: '01099900015', category: 'DRVO015 Hair', service: 'DRVO015 Haircut', pkg: 'DRVO015 Gold' };

const MASTER_TABLES = [
  'TblServicePackageItem',
  'TblServicePackage',
  'TblPro',
  'TblCat',
  'TblClient',
  'TblPaymentMethods',
  'TblExpINCat',
  'TblEmp',
] as const;

function forceStagingEnv(password: string) {
  const server = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = process.env.DRVO_STAGING_DB_PORT || '14330';
  const values: Record<string, string> = {
    CLOUD_DB_SERVER: server,
    CLOUD_DB_PORT: port,
    CLOUD_DB_NAME: STAGING_DB,
    CLOUD_DB_USER: STAGING_LOGIN,
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
    DB_SERVER: server,
    DB_PORT: port,
    DB_DATABASE: STAGING_DB,
    DB_USER: STAGING_LOGIN,
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function buildConfig(): sql.config {
  return {
    server: process.env.DB_SERVER || '',
    port: parseInt(process.env.DB_PORT || '14330', 10),
    database: process.env.DB_DATABASE || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 120000,
  };
}

async function assertLiveDatabase(pool: sql.ConnectionPool) {
  const result = await pool.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login;`);
  const liveDb = String(result.recordset[0].db);
  const login = String(result.recordset[0].login);
  if (liveDb === PRODUCTION_DB) throw new Error(`Refusing production database ${PRODUCTION_DB}`);
  if (liveDb !== STAGING_DB) throw new Error(`Refusing: expected ${STAGING_DB}, got ${liveDb}`);
  if (login.toLowerCase() !== STAGING_LOGIN) {
    throw new Error(`Refusing: expected login ${STAGING_LOGIN}, got ${login}`);
  }
  console.log(`  live database: ${liveDb} (${login})`);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  ok: ${message}`);
}

async function expectSqlError(fn: () => Promise<unknown>, numbers: number[], message: string) {
  try {
    await fn();
  } catch (err) {
    const n = Number((err as { number?: number; originalError?: { info?: { number?: number } } }).number
      ?? (err as { originalError?: { info?: { number?: number } } }).originalError?.info?.number);
    check(numbers.includes(n), `${message} (SQL error ${n})`);
    return;
  }
  throw new Error(`${message}: expected SQL error ${numbers.join('/')}, but the statement succeeded`);
}

async function countsByOwner(pool: sql.ConnectionPool, bootId: string) {
  const out: Record<string, { total: number; boot: number }> = {};
  for (const t of MASTER_TABLES) {
    const r = await pool.request().input('boot', sql.UniqueIdentifier, bootId).query(`
      SELECT COUNT_BIG(*) AS total,
             SUM(CASE WHEN TenantId = @boot THEN 1 ELSE 0 END) AS boot
      FROM dbo.${t} WITH (NOLOCK);
    `);
    out[t] = { total: Number(r.recordset[0].total), boot: Number(r.recordset[0].boot ?? 0) };
  }
  return out;
}

async function cleanupTenant(pool: sql.ConnectionPool, tenantCode: string): Promise<void> {
  const tenant = await pool
    .request()
    .input('code', sql.NVarChar(64), tenantCode)
    .query(`SELECT TenantId FROM dbo.Tenant WHERE Code = @code;`);
  if (!tenant.recordset.length) return;
  const tenantId = String(tenant.recordset[0].TenantId);

  const branchIds = (
    await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`SELECT LegacyBranchId FROM dbo.Location WHERE TenantId = @tenantId;`)
  ).recordset.map((r: { LegacyBranchId: number }) => Number(r.LegacyBranchId));
  const userIds = (
    await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`SELECT LegacyUserId FROM dbo.TenantMembership WHERE TenantId = @tenantId;`)
  ).recordset.map((r: { LegacyUserId: number }) => Number(r.LegacyUserId));

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const t of MASTER_TABLES) {
      await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .query(`DELETE FROM dbo.${t} WHERE TenantId = @tenantId;`);
    }
    await new sql.Request(tx).input('tenantId', sql.UniqueIdentifier, tenantId).query(`
      DELETE FROM dbo.PlatformOutbox WHERE TenantId = @tenantId;
      DELETE FROM dbo.SalonPackConfig WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantIndustryPack WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantSubscription WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantAppEntitlement WHERE TenantId = @tenantId;
      DELETE FROM dbo.LegacyIdMap WHERE TenantId = @tenantId;
      DELETE FROM dbo.TenantMembership WHERE TenantId = @tenantId;
      DELETE FROM dbo.Location WHERE TenantId = @tenantId;
      DELETE FROM dbo.Tenant WHERE TenantId = @tenantId;
    `);
    for (const userId of userIds) {
      await new sql.Request(tx).input('userId', sql.Int, userId).query(`
        DELETE FROM dbo.TblUserBranchAccess WHERE UserID = @userId;
        DELETE FROM dbo.TblUser WHERE UserID = @userId;
      `);
    }
    for (const branchId of branchIds) {
      await new sql.Request(tx).input('branchId', sql.Int, branchId).query(`
        DELETE FROM dbo.QueueBookingSettings WHERE BranchID = @branchId;
        DELETE FROM dbo.TblBranch WHERE BranchID = @branchId;
      `);
    }
    await tx.commit();
    console.log(`  cleanup: removed ${tenantCode}`);
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function cleanupAll(pool: sql.ConnectionPool) {
  for (const t of SMOKE_TENANTS) await cleanupTenant(pool, t.code);
}

async function insertCategory(pool: sql.ConnectionPool, tenantId: string, name: string): Promise<number> {
  const r = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('name', sql.NVarChar(100), name)
    .query(`INSERT INTO dbo.TblCat (TenantId, CatName) OUTPUT INSERTED.CatID VALUES (@tenantId, @name);`);
  return Number(r.recordset[0].CatID);
}

async function insertService(pool: sql.ConnectionPool, tenantId: string, name: string, catId: number, price: number): Promise<number> {
  const r = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('name', sql.NVarChar(100), name)
    .input('catId', sql.Int, catId)
    .input('price', sql.Decimal(10, 2), price)
    .query(`
      INSERT INTO dbo.TblPro (TenantId, ProName, SPrice1, Bonus, CatID, isDeleted)
      OUTPUT INSERTED.ProID
      VALUES (@tenantId, @name, @price, 0, @catId, 0);
    `);
  return Number(r.recordset[0].ProID);
}

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD || '';
  if (!password) {
    console.error('Missing DRVO_STAGING_DB_PASSWORD (staging only; .env.local is never read).');
    process.exit(1);
  }
  forceStagingEnv(password);

  const config = buildConfig();
  if (config.database !== STAGING_DB || config.user !== STAGING_LOGIN) {
    console.error(`Refusing: database must be ${STAGING_DB} as ${STAGING_LOGIN}`);
    process.exit(1);
  }

  const { provisionTenant } = await import('../../src/platform/onboarding/provisionTenant');
  const { resolveLegacyBootstrapTenantId } = await import('../../src/platform/tenant/legacyBootstrapSeam');
  const { SALON_PACK } = await import('../../src/packs/salon/public');
  const { DEFAULT_TENANT_PAYMENT_METHODS, DEFAULT_TENANT_FINANCE_CATEGORIES, DEFAULT_TENANT_SERVICE_CATEGORIES } =
    await import('../../src/platform/masterData/seedTenantMasterData');
  const { verifyMasterDataTenancySchema, verifyNoNullMasterDataTenant } = await import('./migrations/010-master-data-tenancy');
  const { verifyPlatformBootstrap } = await import('./platformBootstrap');
  const { upsertCustomer } = await import('../../src/lib/publicBookingHelpers');
  const { lookupClientIdByPhone } = await import('../../src/lib/client/clientPhoneLookup');
  const website = await import('../../src/lib/client/publicClientWebsite.service');
  const { isTenantCategory, findForeignServiceIds } = await import('../../src/lib/catalog/tenantCatalogGuards');
  const pkgs = await import('../../src/lib/catalog/servicePackages');
  const { getPool } = await import('../../src/lib/db');

  const pool = await sql.connect(config);
  try {
    await assertLiveDatabase(pool);

    console.log('Scenario 1 — migration 10 verify + NULL TenantId verification');
    const verify = await verifyMasterDataTenancySchema(pool);
    if (!verify.ok) {
      throw new Error(`Migration 10 not verified — apply it on staging first (npm run drvo:migrate): ${verify.failures.join('; ')}`);
    }
    check(true, 'migration 10 schema verified (NOT NULL, trusted FKs, tenant uniques, indexes)');
    const nulls = await verifyNoNullMasterDataTenant(pool);
    check(nulls.ok, `zero NULL TenantId (${JSON.stringify(nulls.nullCounts)})`);
    const preflight = await verifyPlatformBootstrap(pool);
    check(preflight.ok, `platform bootstrap verified (${preflight.failures.join('; ') || 'clean'})`);

    await cleanupAll(pool);

    console.log('Scenario 2 — CUT backfill proof');
    const boot = (await resolveLegacyBootstrapTenantId('casher-boot-staging-smoke')).toLowerCase();
    const before = await countsByOwner(pool, boot);
    for (const t of MASTER_TABLES) {
      console.log(`  ${t}: total=${before[t].total} CASHER_BOOT=${before[t].boot}`);
    }
    for (const t of ['TblClient', 'TblPro', 'TblServicePackage'] as const) {
      check(before[t].boot > 0 || before[t].total === 0, `${t} CUT rows are owned by CASHER_BOOT`);
    }

    console.log('Scenario 3 — the database fails closed');
    await expectSqlError(
      () => pool.request().query(`
        BEGIN TRAN; INSERT INTO dbo.TblCat (CatName) VALUES (N'DRVO015 null probe'); ROLLBACK TRAN;
      `),
      [515],
      'a master-data row without TenantId is rejected (NOT NULL)',
    );

    const actorRow = await pool
      .request()
      .query(`SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted, 0) = 0 ORDER BY UserID;`);
    if (!actorRow.recordset.length) throw new Error('No active TblUser row for smoke actor');
    const actor = { actorUserId: Number(actorRow.recordset[0].UserID), actorUserName: 'drvo015-smoke' };

    console.log('Scenario 4 — provision two tenants; minimal default seed');
    const provisioned = [];
    for (const def of SMOKE_TENANTS) {
      provisioned.push(
        await provisionTenant(
          {
            tenantCode: def.code,
            tenantDisplayName: `DRVO-015 ${def.code}`,
            defaultTimezone: 'Africa/Cairo',
            ownerUserName: `${def.code} Owner`,
            ownerLoginName: def.login,
            ownerPassword: 'smoke-pass-change-me',
            firstBranchCode: def.branch,
            firstBranchName: `${def.code} Branch`,
            industryPack: SALON_PACK,
            subscriptionStatus: 'active',
          },
          actor,
        ),
      );
    }
    const A = provisioned[0].tenantId.toLowerCase();
    const B = provisioned[1].tenantId.toLowerCase();
    check(A !== B && A !== boot && B !== boot, 'two distinct non-boot tenants');
    for (const [label, t] of [['A', A], ['B', B]] as const) {
      const r = await pool.request().input('t', sql.UniqueIdentifier, t).query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.TblPaymentMethods WHERE TenantId = @t) AS pm,
          (SELECT COUNT(*) FROM dbo.TblExpINCat WHERE TenantId = @t) AS fin,
          (SELECT COUNT(*) FROM dbo.TblCat WHERE TenantId = @t) AS cat,
          (SELECT COUNT(*) FROM dbo.TblClient WHERE TenantId = @t) AS cli,
          (SELECT COUNT(*) FROM dbo.TblPro WHERE TenantId = @t) AS pro;
      `);
      const s = r.recordset[0];
      check(
        s.pm === DEFAULT_TENANT_PAYMENT_METHODS.length &&
          s.fin === DEFAULT_TENANT_FINANCE_CATEGORIES.length &&
          s.cat === DEFAULT_TENANT_SERVICE_CATEGORIES.length,
        `tenant ${label} seeded with minimal defaults (pm=${s.pm} fin=${s.fin} cat=${s.cat})`,
      );
      check(s.cli === 0 && s.pro === 0, `tenant ${label} received no CUT customers or services`);
    }

    console.log('Scenario 5 — same-named master data in both tenants');
    const ids: Record<string, { cat: number; pro: number; client: number; pkg: number }> = {};
    const db = await getPool();
    for (const [t, price] of [[A, 100], [B, 250]] as const) {
      const cat = await insertCategory(pool, t, SHARED.category);
      const pro = await insertService(pool, t, SHARED.service, cat, price);
      const client = await upsertCustomer(SHARED.customer, SHARED.phone, undefined, t);
      const pkg = await pkgs.createServicePackage(db, t, {
        NameEn: SHARED.pkg, NameAr: null, PackageKind: 'regular', PackagePrice: price * 3, OriginalPrice: null,
        DurationMinutes: 60, Bonus: 0, ImageUrl: null, DescriptionAr: null, DescriptionEn: null, SortOrder: 0,
        IsPopular: false, isActive: true, DepositAmount: null, IncludesTrial: false, SessionCount: null, NotesAr: null,
        items: [{ ProID: pro, Qty: 1, SortOrder: 10, IsOptional: false }],
      });
      ids[t] = { cat, pro, client, pkg: pkg.PackageID };
    }
    check(
      ids[A].cat !== ids[B].cat && ids[A].pro !== ids[B].pro && ids[A].client !== ids[B].client && ids[A].pkg !== ids[B].pkg,
      'same-named customer, category, service and package exist independently in A and B',
    );

    console.log('Scenario 6 — neither tenant sees or updates the other');
    check((await lookupClientIdByPhone(A, SHARED.phone)).clientId === ids[A].client, 'phone lookup in A returns A customer');
    check((await lookupClientIdByPhone(B, SHARED.phone)).clientId === ids[B].client, 'phone lookup in B returns B customer');
    check((await website.lookupClientByMobile(A, SHARED.phone))?.id === ids[A].client, 'public website lookup scoped to A');
    check(await upsertCustomer(SHARED.customer, SHARED.phone, undefined, A) === ids[A].client, 'booking upsert in A reuses A customer only');
    const crossUpdate = await website.updateClientWebsiteProfile(A, { clientId: ids[B].client, address: 'hijack' });
    check(!crossUpdate.ok, 'tenant A cannot update tenant B customer by id');
    check(await isTenantCategory(db, A, ids[B].cat) === false, 'tenant A cannot use tenant B category');
    check((await findForeignServiceIds(db, A, [ids[A].pro, ids[B].pro])).join() === String(ids[B].pro), 'tenant B service is foreign to A');
    check(await pkgs.getServicePackageById(db, A, ids[B].pkg) === null, 'tenant A by-id package read of B is not-found');
    check(await pkgs.softDeleteServicePackage(db, A, ids[B].pkg) === false, 'tenant A cannot delete tenant B package');
    const listA = await pkgs.listServicePackages(db, A, {});
    check(listA.length === 1 && listA[0].PackageID === ids[A].pkg, 'tenant A package list has only its own package');
    await expectSqlError(
      () => pool.request()
        .input('tenantId', sql.UniqueIdentifier, B)
        .input('pkg', sql.Int, ids[A].pkg)
        .input('pro', sql.Int, ids[B].pro)
        .query(`
          BEGIN TRAN;
          INSERT INTO dbo.TblServicePackageItem (TenantId, PackageID, ProID, Qty, SortOrder, IsOptional)
          VALUES (@tenantId, @pkg, @pro, 1, 99, 0);
          ROLLBACK TRAN;
        `),
      [547],
      'a package item cannot attach to another tenant package (composite FK)',
    );
    const b = await pool.request().input('id', sql.Int, ids[B].client)
      .query(`SELECT Address FROM dbo.TblClient WHERE ClientID = @id;`);
    check((b.recordset[0]?.Address ?? null) !== 'hijack', 'tenant B customer row unchanged');

    console.log('Scenario 7 — cleanup; CASHER_BOOT unchanged');
    await cleanupAll(pool);
    const residue = await pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.Tenant WHERE Code LIKE N'DRVO015[_]%';`);
    check(Number(residue.recordset[0].cnt) === 0, 'no DRVO015 residue');
    const after = await countsByOwner(pool, boot);
    for (const t of MASTER_TABLES) {
      check(after[t].boot === before[t].boot, `${t} CASHER_BOOT count unchanged (${after[t].boot})`);
    }
    const nullsAfter = await verifyNoNullMasterDataTenant(pool);
    check(nullsAfter.ok, 'still zero NULL TenantId after the smoke');

    console.log('DRVO-015 smoke PASS');
  } finally {
    try {
      await cleanupAll(pool);
    } catch {
      /* best effort */
    }
    await pool.close();
  }
}

main().catch((err) => {
  console.error('DRVO-015 smoke FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
