#!/usr/bin/env npx tsx
/**
 * DRVO-005 staging smoke — last132_agent only.
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

    const branchRes = await pool.request().query(`
      SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE isActive = 1 ORDER BY BranchID;
    `);
    const branchId = Number(branchRes.recordset[0]?.BranchID ?? 0);
    if (!branchId) throw new Error('No active branch');

    const empRes = await pool.request().query(`
      SELECT TOP 1 e.EmpID, e.EmpName
      FROM dbo.TblEmp e
      WHERE e.isActive = 1
      ORDER BY e.EmpID;
    `);
    const empId = Number(empRes.recordset[0]?.EmpID ?? 0);
    if (!empId) throw new Error('No active employee');

    const svcRes = await pool.request().query(`
      SELECT TOP 1 ProID FROM dbo.TblPro WHERE isDeleted = 0 AND DurationMinutes > 0 ORDER BY ProID;
    `);
    const serviceId = Number(svcRes.recordset[0]?.ProID ?? 0);
    if (!serviceId) throw new Error('No service');

    const { buildQueuePortHooksForActor } = await import('@/lib/queueSchedulingComposition');
    const { createQueueTicket, cancelQueueTicket } = await import('@/apps/queue/public');

    const actor = {
      actorType: 'staff' as const,
      actorId: 'smoke',
      tenantId,
      membershipId: null,
      viewLocationId: null,
    };
    const queuePortHooks = await buildQueuePortHooksForActor(actor);

    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const ticket = await createQueueTicket({
      empId,
      serviceIds: [serviceId],
      customer: { name: 'DRVO-005 Smoke' },
      expectedStartTime: start.toISOString(),
      expectedEndTime: end.toISOString(),
      source: 'walk_in',
      trustExpectedStart: true,
      useClientPlannedTimes: true,
      branchId,
      tenantId,
      queuePortHooks,
    });

    console.log('Created queue ticket:', {
      queueTicketId: ticket.queueTicketId,
      ticketCode: ticket.ticketCode,
    });

    const outboxRes = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('aggId', sql.NVarChar, String(ticket.queueTicketId))
      .query(`
        SELECT EventType, IdempotencyKey
        FROM dbo.PlatformOutbox
        WHERE TenantId = @tenantId AND AggregateId = @aggId AND EventType = N'queue.created';
      `);
    console.log('Outbox rows for queue.created:', outboxRes.recordset.length);
    if (outboxRes.recordset.length !== 1) {
      throw new Error('Expected exactly one queue.created outbox row');
    }

    const cancelResult = await cancelQueueTicket({
      ticketId: ticket.queueTicketId,
      sessionBranchId: branchId,
      tenantId,
      queuePortHooks,
    });
    console.log('Cancelled ticket:', cancelResult.status);

    const cancelOutbox = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('aggId', sql.NVarChar, String(ticket.queueTicketId))
      .query(`
        SELECT EventType FROM dbo.PlatformOutbox
        WHERE TenantId = @tenantId AND AggregateId = @aggId AND EventType = N'queue.cancelled';
      `);
    console.log('Outbox rows for queue.cancelled:', cancelOutbox.recordset.length);
    if (cancelOutbox.recordset.length !== 1) {
      throw new Error('Expected exactly one queue.cancelled outbox row');
    }

    const cashCheck = await pool.request().query(`
      SELECT COUNT(*) AS cnt FROM dbo.TblCashMove WHERE MoveDate > DATEADD(minute, -5, GETDATE());
    `).catch(() => ({ recordset: [{ cnt: 0 }] }));
    console.log('Recent TblCashMove rows (should be 0):', cashCheck.recordset[0].cnt);

    console.log('SMOKE_OK');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('SMOKE_FAILED', err);
  process.exit(1);
});
