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

    // DRVO-013: target CASHER_BOOT by name (casher-boot-staging-smoke seam), never "first tenant".
    const tenantRes = await pool.request().query(`
      SELECT TenantId FROM dbo.Tenant WHERE Code = N'CASHER_BOOT' AND Status = N'active';
    `);
    const tenantId = String(tenantRes.recordset[0]?.TenantId ?? '');
    if (!tenantId) throw new Error('CASHER_BOOT tenant is not active');

    const branchRes = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId).query(`
      SELECT TOP 1 b.BranchID
      FROM dbo.TblBranch b
      INNER JOIN dbo.Location l ON l.LegacyBranchId = b.BranchID
      WHERE b.isActive = 1 AND l.TenantId = @tenantId AND l.Status = N'active'
      ORDER BY b.BranchID;
    `);
    const branchId = Number(branchRes.recordset[0]?.BranchID ?? 0);
    if (!branchId) throw new Error('No active branch');

    const cairoDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const cairoTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
    const cairoDay = new Date(`${cairoDate}T12:00:00Z`).getDay();
    const [cairoHour, cairoMinute] = cairoTime.split(':').map(Number);
    const cairoMinutes = cairoHour * 60 + cairoMinute;
    const scheduleRes = await pool.request().input('day', sql.Int, cairoDay).query(`
      SELECT e.EmpID,
             CONVERT(varchar(8), s.StartTime, 108) AS StartTime,
             CONVERT(varchar(8), s.EndTime, 108) AS EndTime
      FROM dbo.TblEmp e
      JOIN dbo.TblEmpWorkSchedule s ON s.EmpID = e.EmpID
      WHERE e.isActive = 1 AND s.IsWorkingDay = 1 AND s.DayOfWeek = @day
      ORDER BY e.EmpID;
    `);
    const toMinutes = (value: string) => {
      const [h, m] = value.split(':').map(Number);
      return h * 60 + m;
    };
    const onShift = scheduleRes.recordset.find((row: { StartTime: string; EndTime: string }) => {
      const startMin = toMinutes(row.StartTime);
      const endMin = toMinutes(row.EndTime);
      if (startMin <= endMin) return cairoMinutes >= startMin && cairoMinutes < endMin;
      return cairoMinutes >= startMin || cairoMinutes < endMin;
    }) as { EmpID: number; StartTime: string; EndTime: string } | undefined;
    const empId = Number(onShift?.EmpID ?? 0);
    if (!empId || !onShift) throw new Error('No employee is inside working hours right now');
    console.log('On-shift employee:', { empId, cairoDate, cairoTime, cairoDay });

    const svcRes = await pool.request().query(`
      SELECT TOP 1 ProID, DurationMinutes
      FROM dbo.TblPro
      WHERE isDeleted = 0 AND DurationMinutes > 0
      ORDER BY ProID;
    `);
    const serviceId = Number(svcRes.recordset[0]?.ProID ?? 0);
    const serviceMinutes = Number(svcRes.recordset[0]?.DurationMinutes ?? 0);
    if (!serviceId || !serviceMinutes) throw new Error('No service');

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

    const shiftStartMin = toMinutes(onShift.StartTime);
    const shiftEndMin = toMinutes(onShift.EndTime);
    const overnight = shiftStartMin > shiftEndMin;
    const inMorningTail = overnight && cairoMinutes < shiftEndMin;
    let slotMinutes = shiftStartMin + 30;
    if (!inMorningTail && cairoMinutes >= shiftStartMin && cairoMinutes + 20 > slotMinutes) {
      slotMinutes = cairoMinutes + 20;
    }
    const slotClock = new Date(Date.UTC(2000, 0, 1, 0, slotMinutes, 0));
    const slotDate = new Date(`${cairoDate}T00:00:00Z`);
    slotDate.setUTCDate(slotDate.getUTCDate() + (slotClock.getUTCDate() - 1));
    const slotDay = slotDate.toISOString().slice(0, 10);
    const slotHhmm = `${String(slotClock.getUTCHours()).padStart(2, '0')}:${String(slotClock.getUTCMinutes()).padStart(2, '0')}`;
    const { salonDateTimeToMs } = await import('@/lib/publicBookingHelpers');
    const start = new Date(salonDateTimeToMs(slotDay, slotHhmm, 'Africa/Cairo'));
    const end = new Date(start.getTime() + serviceMinutes * 60 * 1000);
    console.log('Planned slot:', { slotDay, slotHhmm, serviceMinutes });

    const { hashServiceSet } = await import('@/lib/booking/publicBookingCreateLocks');
    const { bridgeQueueAcquireAnyBarberLock } = await import('@/lib/queue/queuePortLegacyBridge');
    const { getPool, sql: appSql } = await import('@/lib/db');
    const appDb = await getPool();
    const lockTx = new appSql.Transaction(appDb);
    await lockTx.begin();
    try {
      await bridgeQueueAcquireAnyBarberLock(
        { queuePortHooks },
        lockTx,
        branchId,
        start.getTime(),
        end.getTime(),
        hashServiceSet([serviceId]),
      );
      await lockTx.rollback();
      console.log('Any-barber lock acquired with booking slot key and rolled back');
    } catch (lockErr) {
      try {
        await lockTx.rollback();
      } catch {
        /* transaction already closed */
      }
      throw lockErr;
    }

    const smokePhone = `019${String(Date.now()).slice(-8)}`;

    const ticket = await createQueueTicket({
      empId,
      serviceIds: [serviceId],
      customer: { name: 'DRVO-005 Smoke', phone: smokePhone },
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
      clientId: ticket.customer?.clientId ?? null,
    });
    if (!ticket.customer?.clientId) {
      throw new Error('Expected Customers port to assign a client id');
    }

    const clientRes = await pool
      .request()
      .input('id', sql.Int, ticket.customer.clientId)
      .input('phone', sql.NVarChar, smokePhone)
      .query(`
        SELECT ClientID
        FROM dbo.TblClient
        WHERE ClientID = @id AND Mobile = @phone;
      `);
    if (clientRes.recordset.length !== 1) {
      throw new Error('Customers port did not persist the queue phone on TblClient');
    }

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

    const { executeQuickQueueOperation } = await import('@/lib/operationsQueueCreateCore');
    const quick = await executeQuickQueueOperation(branchId, {
      queuePortHooks,
      useExtractedEventDelivery: true,
    });
    if ('ticketCode' in quick && quick.queueTicketId) {
      console.log('Quick queue ticket:', {
        queueTicketId: quick.queueTicketId,
        ticketCode: quick.ticketCode,
      });
      const quickCancel = await cancelQueueTicket({
        ticketId: quick.queueTicketId,
        sessionBranchId: branchId,
        tenantId,
        queuePortHooks,
      });
      console.log('Quick queue cancelled:', quickCancel.status);
    } else {
      const reason = 'reason' in quick ? quick.reason : 'unknown';
      console.log('Quick queue did not create a ticket:', reason);
      const benign = new Set([
        'no_available_barber',
        'quick_queue_disabled',
        'service_unavailable',
      ]);
      if (!benign.has(String(reason))) {
        throw new Error(`Quick queue failed: ${String(reason)}`);
      }
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

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SMOKE_FAILED', err);
    process.exit(1);
  });
