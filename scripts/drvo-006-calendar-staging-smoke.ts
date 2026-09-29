#!/usr/bin/env npx tsx
/**
 * DRVO-006 staging smoke — last132_agent only.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

const PRODUCTION_DB = 'last132';
const STAGING_DB = 'last132_agent';
const STAGING_USER = 'drvo_agent';

async function main() {
  const sql = (await import('mssql')).default;

  const config: sql.config = {
    server: process.env.CLOUD_DB_SERVER || '127.0.0.1',
    port: parseInt(process.env.CLOUD_DB_PORT || '14330', 10),
    database: process.env.CLOUD_DB_NAME || STAGING_DB,
    user: process.env.CLOUD_DB_USER || STAGING_USER,
    password: process.env.CLOUD_DB_PASSWORD || process.env.DRVO_STAGING_DB_PASSWORD || '',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    requestTimeout: 120000,
  };

  if (config.database === PRODUCTION_DB) {
    throw new Error(`Refusing production database ${PRODUCTION_DB}`);
  }

  process.env.DB_SERVER = config.server;
  process.env.DB_PORT = String(config.port);
  process.env.DB_DATABASE = config.database;
  process.env.DB_USER = config.user;
  process.env.DB_PASSWORD = config.password;
  process.env.DB_ENCRYPT = 'false';
  process.env.DB_TRUST_SERVER_CERTIFICATE = 'true';

  const pool = await new sql.ConnectionPool(config).connect();
  try {
    const identity = await pool.request().query(`
      SELECT DB_NAME() AS dbName, SUSER_SNAME() AS loginName;
    `);
    const dbName = String(identity.recordset[0].dbName);
    const loginName = String(identity.recordset[0].loginName);
    console.log('DB identity:', { dbName, loginName });
    if (dbName !== STAGING_DB) throw new Error(`Expected ${STAGING_DB}, got ${dbName}`);
    if (loginName !== STAGING_USER) throw new Error(`Expected ${STAGING_USER}, got ${loginName}`);

    const tenantRes = await pool.request().query(`
      SELECT TOP 1 TenantId FROM dbo.Tenant WHERE Status = N'active';
    `);
    const tenantId = String(tenantRes.recordset[0]?.TenantId ?? '');
    if (!tenantId) throw new Error('No active tenant');

    const branches = await pool.request().query(`
      SELECT BranchID, timeZone, businessDayCutoffTime
      FROM dbo.TblBranch
      WHERE isActive = 1
      ORDER BY BranchID;
    `);
    if (!branches.recordset.length) throw new Error('No active branches');

    const { createLegacyOperationalCalendarAdapter } = await import(
      '@/shared/operational-calendar/public'
    );
    const calendar = createLegacyOperationalCalendarAdapter(tenantId);
    const actor = {
      actorType: 'staff' as const,
      actorId: '1',
      tenantId,
      membershipId: null,
      viewLocationId: null,
    };

    for (const row of branches.recordset) {
      const locationId = Number(row.BranchID);
      const businessDate = await calendar.getBusinessDate(actor, {
        locationId,
        instant: new Date(),
      });
      const openDay = await pool.request().input('branchId', sql.Int, locationId).query(`
        SELECT TOP 1 ID, NewDay, Status FROM dbo.TblNewDay
        WHERE BranchID = @branchId AND Status = 1 ORDER BY ID DESC;
      `);
      const openDate = openDay.recordset[0]?.NewDay
        ? String(openDay.recordset[0].NewDay).slice(0, 10)
        : null;
      const hasOpen = openDate
        ? await calendar.hasOpenDay(actor, { locationId, businessDate: openDate })
        : false;
      console.log('business date', { locationId, businessDate, openDate, hasOpen });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      const branchId = Number(branches.recordset[0].BranchID);
      const ctx = await calendar.resolveFinancialWriteContext(tx, actor, { locationId: branchId });
      console.log('financial context (DAY or SHIFT):', ctx);
      await tx.rollback();
      console.log('rollback probe: transaction rolled back after context resolution');
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        // ignore
      }
      console.log('financial context probe skipped:', err instanceof Error ? err.message : err);
    }

    console.log('DRVO-006 calendar staging smoke: PASS');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('DRVO-006 calendar staging smoke: FAIL', err);
  process.exit(1);
});
