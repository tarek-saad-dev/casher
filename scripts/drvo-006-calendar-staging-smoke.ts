#!/usr/bin/env npx tsx
/**
 * DRVO-006 staging smoke — last132_agent only.
 * Probes fail the process. A caught error is never reported as PASS.
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

function forceStagingEnv(password: string) {
  const values: Record<string, string> = {
    CLOUD_DB_SERVER: '127.0.0.1',
    CLOUD_DB_PORT: '14330',
    CLOUD_DB_NAME: STAGING_DB,
    CLOUD_DB_USER: STAGING_USER,
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
    DB_SERVER: '127.0.0.1',
    DB_PORT: '14330',
    DB_DATABASE: STAGING_DB,
    DB_NAME: STAGING_DB,
    DB_USER: STAGING_USER,
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
    LOCAL_DB_SERVER: '127.0.0.1',
    LOCAL_DB_PORT: '14330',
    LOCAL_DB_NAME: STAGING_DB,
    LOCAL_DB_USER: STAGING_USER,
    LOCAL_DB_PASSWORD: password,
    LOCAL_DB_ENCRYPT: 'false',
    LOCAL_DB_TRUST_CERT: 'true',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  delete process.env.HAWAI_DB_CLASS;
  delete process.env.BOOKING_V2_DB_CLASS;
  delete process.env.BOOKING_V2_FORCE_LOCAL_DB;
  delete process.env.BOOKING_V2_USE_TRUSTED_CONNECTION;
  delete process.env.DB_TRUSTED_CONNECTION;
  delete process.env.LOCAL_DB_TRUSTED_CONNECTION;
}

function domainCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) return String((err as { code: unknown }).code);
  return '';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function expectDomain(run: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await run();
  } catch (err) {
    const got = domainCode(err);
    if (got !== code) {
      throw new Error(`Expected ${code}, got ${got || errorMessage(err)}`);
    }
    return;
  }
  throw new Error(`Expected ${code} but the call succeeded`);
}

async function main() {
  const password =
    process.env.DRVO_STAGING_DB_PASSWORD ||
    process.env.CLOUD_DB_PASSWORD ||
    process.env.DB_PASSWORD ||
    '';
  if (!password) throw new Error('Missing staging database password');
  forceStagingEnv(password);

  const sql = (await import('mssql')).default;
  const config: sql.config = {
    server: '127.0.0.1',
    port: 14330,
    database: STAGING_DB,
    user: STAGING_USER,
    password,
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

  const pool = await new sql.ConnectionPool(config).connect();
  let closeAppPool: (() => Promise<void>) | null = null;
  try {
    await assertIdentity(pool);

    const dbModule = await import('@/lib/db');
    closeAppPool = dbModule.closePool;
    const appPool = await dbModule.getPool();
    await assertIdentity(appPool);

    // DRVO-013: target CASHER_BOOT by name (casher-boot-staging-smoke seam), never "first tenant".
    const tenantRes = await pool.request().query(`
      SELECT TenantId FROM dbo.Tenant WHERE Code = N'CASHER_BOOT' AND Status = N'active';
    `);
    const tenantId = String(tenantRes.recordset[0]?.TenantId ?? '');
    if (!tenantId) throw new Error('CASHER_BOOT tenant is not active');

    const branches = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId).query(`
      SELECT b.BranchID, b.timeZone, b.businessDayCutoffTime
      FROM dbo.TblBranch b
      INNER JOIN dbo.Location l ON l.LegacyBranchId = b.BranchID
      WHERE b.isActive = 1 AND l.TenantId = @tenantId AND l.Status = N'active'
      ORDER BY b.BranchID;
    `);
    if (branches.recordset.length < 1) throw new Error('No active branches');

    const { createLegacyOperationalCalendarAdapter } = await import(
      '@/shared/operational-calendar/public'
    );
    const calendar = createLegacyOperationalCalendarAdapter(tenantId);

    const operatorRes = await pool.request().query(`
      SELECT TOP 1
        u.UserID,
        uba.BranchID,
        CASE WHEN sm.ID IS NULL THEN 0 ELSE 1 END AS HasOpenShift
      FROM dbo.TblUser u
      INNER JOIN dbo.TblUserBranchAccess uba ON uba.UserID = u.UserID
      INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
      LEFT JOIN dbo.TblShiftMove sm ON sm.UserID = u.UserID AND sm.Status = 1
      WHERE ISNULL(u.isDeleted, 0) = 0
        AND uba.IsActive = 1
        AND uba.CanOperate = 1
        AND b.isActive = 1
        AND uba.ValidFrom <= GETDATE()
        AND (uba.ValidTo IS NULL OR uba.ValidTo > GETDATE())
      ORDER BY CASE WHEN sm.ID IS NULL THEN 0 ELSE 1 END, u.UserID, uba.BranchID;
    `);
    const operator = operatorRes.recordset[0] as
      | { UserID: number; BranchID: number; HasOpenShift: number }
      | undefined;
    if (!operator) throw new Error('No CanOperate staff user on an active branch');

    const actor = {
      actorType: 'staff' as const,
      actorId: String(operator.UserID),
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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
        throw new Error(`Business date missing for location ${locationId}`);
      }
      const openDay = await pool.request().input('branchId', sql.Int, locationId).query(`
        SELECT TOP 1 ID, NewDay, Status FROM dbo.TblNewDay
        WHERE BranchID = @branchId AND Status = 1 ORDER BY ID DESC;
      `);
      const rawOpen = openDay.recordset[0]?.NewDay;
      const openDate = rawOpen instanceof Date
        ? rawOpen.toISOString().slice(0, 10)
        : rawOpen
          ? String(rawOpen).slice(0, 10)
          : null;
      const hasOpen = openDate
        ? await calendar.hasOpenDay(actor, { locationId, businessDate: openDate })
        : false;
      if (openDate && !hasOpen) {
        throw new Error(`hasOpenDay disagreed with TblNewDay for location ${locationId}`);
      }
      console.log('business date', { locationId, businessDate, openDate, hasOpen });
    }

    const shiftDefRes = await pool.request().query(`
      SELECT TOP 1 ShiftID FROM dbo.TblShift ORDER BY ShiftID;
    `);
    const shiftDefinitionId = Number(shiftDefRes.recordset[0]?.ShiftID ?? 0);
    if (!shiftDefinitionId) throw new Error('No shift definition');

    const otherBranch = branches.recordset
      .map((row: { BranchID: number }) => Number(row.BranchID))
      .find((id: number) => id !== Number(operator.BranchID));

    const before = await snapshot(pool, tenantId);
    await assertIdentity(pool);
    await runShiftAndDayProbe(sql, pool, calendar, actor, {
      userId: Number(operator.UserID),
      branchId: Number(operator.BranchID),
      shiftDefinitionId,
      requestedLocationId: otherBranch ?? Number(operator.BranchID),
    });
    await assertSnapshot(pool, tenantId, before, 'SHIFT/DAY probe');

    await assertIdentity(pool);
    await runCloseOpenRollbackProbe(sql, pool, calendar, actor, Number(operator.BranchID));
    await assertSnapshot(pool, tenantId, before, 'close/open rollback probe');

    console.log('DRVO-006 calendar staging smoke: PASS');
  } finally {
    await pool.close();
    if (closeAppPool) await closeAppPool().catch(() => undefined);
  }
}

async function assertIdentity(pool: { request: () => { query: (q: string) => Promise<{ recordset: Array<Record<string, unknown>> }> } }) {
  const identity = await pool.request().query(`
    SELECT DB_NAME() AS dbName, SUSER_SNAME() AS loginName;
  `);
  const dbName = String(identity.recordset[0].dbName);
  const loginName = String(identity.recordset[0].loginName);
  console.log('DB identity:', { dbName, loginName });
  if (dbName === PRODUCTION_DB || dbName !== STAGING_DB) {
    throw new Error(`Refusing database ${dbName}`);
  }
  if (loginName !== STAGING_USER) throw new Error(`Expected ${STAGING_USER}, got ${loginName}`);
}

async function snapshot(pool: { request: () => { input: Function; query: Function } }, tenantId: string) {
  const request = pool.request();
  const days = await request.input('tenantId', (await import('mssql')).default.UniqueIdentifier, tenantId).query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblNewDay) AS dayCount,
      (SELECT COUNT(*) FROM dbo.TblNewDay WHERE Status = 1) AS openDayCount,
      (SELECT ISNULL(MAX(ID), 0) FROM dbo.TblNewDay) AS maxDayId,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, Status)) FROM dbo.TblNewDay) AS dayChecksum,
      (SELECT COUNT(*) FROM dbo.TblShiftMove WHERE Status = 1) AS openShiftCount,
      (SELECT CHECKSUM_AGG(CHECKSUM(ID, Status)) FROM dbo.TblShiftMove WHERE Status = 1) AS openShiftChecksum,
      (SELECT COUNT(*) FROM dbo.PlatformOutbox WHERE TenantId = @tenantId) AS outboxCount;
  `);
  return JSON.stringify(days.recordset[0]);
}

async function assertSnapshot(
  pool: { request: () => { input: Function; query: Function } },
  tenantId: string,
  before: string,
  label: string,
) {
  const after = await snapshot(pool, tenantId);
  if (after !== before) {
    throw new Error(`${label} changed staging calendar state. before=${before} after=${after}`);
  }
  console.log('snapshot unchanged', { label });
}

type SqlModule = typeof import('mssql');

async function runShiftAndDayProbe(
  sql: SqlModule,
  pool: { transaction: () => { begin: () => Promise<void>; rollback: () => Promise<void>; request?: never } & object },
  calendar: {
    openDay: Function;
    openShift: Function;
    closeShift: Function;
    resolveFinancialWriteContext: Function;
  },
  actor: {
    actorType: 'staff';
    actorId: string;
    tenantId: string;
    membershipId: null;
    viewLocationId: null;
  },
  input: {
    userId: number;
    branchId: number;
    shiftDefinitionId: number;
    requestedLocationId: number;
  },
) {
  const tx = pool.transaction();
  await tx.begin();
  try {
    const existing = await new sql.Request(tx as never)
      .input('userId', sql.Int, input.userId)
      .query(`
        SELECT TOP 1 ID, BranchID, BusinessDayID
        FROM dbo.TblShiftMove
        WHERE Status = 1 AND UserID = @userId
        ORDER BY ID DESC;
      `);
    let shiftInstanceId = Number(existing.recordset[0]?.ID ?? 0);
    let shiftBranchId = Number(existing.recordset[0]?.BranchID ?? 0);

    if (!shiftInstanceId) {
      const openDay = await new sql.Request(tx as never)
        .input('branchId', sql.Int, input.branchId)
        .query(`
          SELECT TOP 1 ID
          FROM dbo.TblNewDay
          WHERE BranchID = @branchId AND Status = 1
          ORDER BY ID DESC;
        `);
      if (!openDay.recordset[0]) {
        await calendar.openDay(tx, actor, { locationId: input.branchId });
      }
      const opened = await calendar.openShift(tx, actor, {
        locationId: input.branchId,
        shiftDefinitionId: input.shiftDefinitionId,
      });
      shiftInstanceId = Number(opened.shiftInstanceId);
      shiftBranchId = Number(opened.locationId);
    }

    const shiftCtx = await calendar.resolveFinancialWriteContext(tx, actor, {
      locationId: input.requestedLocationId,
    });
    if (shiftCtx.scope !== 'SHIFT') throw new Error(`Expected SHIFT scope, got ${shiftCtx.scope}`);
    if (Number(shiftCtx.locationId) !== shiftBranchId) {
      throw new Error(
        `SHIFT context location ${shiftCtx.locationId} did not follow shift branch ${shiftBranchId}`,
      );
    }
    if (Number(shiftCtx.shiftInstanceId) !== shiftInstanceId) {
      throw new Error('SHIFT context did not use the open shift');
    }
    if (!shiftCtx.businessDayId || !shiftCtx.businessDate) {
      throw new Error('SHIFT context missing business day');
    }
    console.log('SHIFT context', {
      scope: shiftCtx.scope,
      locationId: shiftCtx.locationId,
      businessDayId: shiftCtx.businessDayId,
      businessDate: shiftCtx.businessDate,
    });

    await calendar.closeShift(tx, actor, {
      shiftInstanceId,
      locationId: shiftBranchId,
    });

    const dayCtx = await calendar.resolveFinancialWriteContext(tx, actor, {
      locationId: shiftBranchId,
    });
    if (dayCtx.scope !== 'DAY') throw new Error(`Expected DAY scope, got ${dayCtx.scope}`);
    if (dayCtx.shiftInstanceId != null) throw new Error('DAY fallback kept a shift');
    if (Number(dayCtx.locationId) !== shiftBranchId) {
      throw new Error(`DAY fallback location ${dayCtx.locationId} != ${shiftBranchId}`);
    }
    if (!dayCtx.businessDayId || !dayCtx.businessDate) throw new Error('DAY fallback missing business day');
    console.log('DAY fallback', {
      scope: dayCtx.scope,
      locationId: dayCtx.locationId,
      businessDayId: dayCtx.businessDayId,
      businessDate: dayCtx.businessDate,
    });

    await tx.rollback();
    console.log('SHIFT/DAY probe rolled back');
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    throw err;
  }
}

async function runCloseOpenRollbackProbe(
  sql: SqlModule,
  pool: { transaction: () => { begin: () => Promise<void>; rollback: () => Promise<void> } },
  calendar: { openDay: Function; closeDay: Function },
  actor: {
    actorType: 'staff';
    actorId: string;
    tenantId: string;
    membershipId: null;
    viewLocationId: null;
  },
  locationId: number,
) {
  const tx = pool.transaction();
  await tx.begin();
  let mutated = false;
  try {
    const openDay = await new sql.Request(tx as never)
      .input('branchId', sql.Int, locationId)
      .query(`
        SELECT TOP 1 ID, CONVERT(varchar(10), NewDay, 23) AS NewDay
        FROM dbo.TblNewDay
        WHERE BranchID = @branchId AND Status = 1
        ORDER BY ID DESC;
      `);
    let dayId = Number(openDay.recordset[0]?.ID ?? 0);
    let businessDate = openDay.recordset[0]?.NewDay ? String(openDay.recordset[0].NewDay) : '';
    if (!dayId) {
      const opened = await calendar.openDay(tx, actor, { locationId });
      mutated = true;
      dayId = Number(opened.businessDayId);
      businessDate = String(opened.businessDate);
    }

    let closed: { businessDayId: number; businessDate: string };
    try {
      closed = await calendar.closeDay(tx, actor, { locationId, forceCloseShifts: false });
    } catch (err) {
      if (domainCode(err) !== 'OPEN_SHIFTS') throw err;
      console.log('close/open contract', { openShifts: 'OPEN_SHIFTS' });
      closed = await calendar.closeDay(tx, actor, { locationId, forceCloseShifts: true });
    }
    mutated = true;
    if (Number(closed.businessDayId) !== dayId) {
      throw new Error('closeDay did not close the open day');
    }
    businessDate = String(closed.businessDate || businessDate);

    await expectDomain(
      () => calendar.closeDay(tx, actor, { locationId, forceCloseShifts: true }),
      'BUSINESS_DAY_ALREADY_CLOSED',
    );

    const reopened = await calendar.openDay(tx, actor, { locationId, businessDate });
    if (Number(reopened.businessDayId) !== dayId) {
      throw new Error(
        `reopen created day ${reopened.businessDayId} instead of reusing ${dayId}`,
      );
    }

    await expectDomain(
      () => calendar.openDay(tx, actor, { locationId, businessDate }),
      'ALREADY_OPEN_BUSINESS_DAY',
    );

    const closedAgain = await calendar.closeDay(tx, actor, { locationId, forceCloseShifts: true });
    if (Number(closedAgain.businessDayId) !== dayId) {
      throw new Error('second close did not target the reopened day');
    }
    const reopenedAgain = await calendar.openDay(tx, actor, { locationId, businessDate });
    if (Number(reopenedAgain.businessDayId) !== dayId) {
      throw new Error('second reopen did not reuse the day id');
    }

    console.log('close/open contract', {
      dayId,
      businessDate,
      secondClose: 'success',
      duplicateOpen: 'ALREADY_OPEN_BUSINESS_DAY',
      duplicateClose: 'BUSINESS_DAY_ALREADY_CLOSED',
    });

    throw Object.assign(new Error('DRVO-006 forced UnitOfWork failure'), {
      code: 'FORCED_UOW_FAILURE',
    });
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    if (domainCode(err) !== 'FORCED_UOW_FAILURE') throw err;
    if (!mutated) throw new Error('Rollback probe failed before any calendar mutation');
    console.log('rollback probe: forced UnitOfWork failure rolled back');
  }
}

main().catch((err) => {
  console.error('DRVO-006 calendar staging smoke: FAIL', err);
  process.exit(1);
});
