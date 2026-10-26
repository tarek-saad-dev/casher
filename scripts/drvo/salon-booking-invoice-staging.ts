#!/usr/bin/env npx tsx
/**
 * Salon conversion isolation real-SQL proof: isolated disposable tenant → service → barber
 * → weekly rota → public slot → signed plan → booking → replay → cleanup.
 * Run ONLY on last132_agent as drvo_agent, through dedicated staging tunnel.
 * No .env.local, no external messages, no CUT writes, no production access.
 */
import Module from 'module';
import crypto from 'node:crypto';
import sql from 'mssql';

const loader = Module as unknown as { _load: (name: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = loader._load;
loader._load = function guardedServerOnly(name, parent, isMain) {
  if (name === 'server-only') return {};
  return originalLoad.call(loader, name, parent, isMain);
};

const EXPECTED_DB = 'last132_agent';
const EXPECTED_LOGIN = 'drvo_agent';
const SMOKE_PHONE = '010' + String(crypto.randomInt(10000000, 99999999));
const REQUEST_KEY = 'SALON-E2E-' + crypto.randomBytes(8).toString('hex');

function check(value: unknown, description: string): asserts value {
  if (!value) throw new Error(description);
  console.log('PASS: ' + description);
}

function forceStagingConfig() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('Missing DRVO_STAGING_DB_PASSWORD; refusing to run');
  if (process.env.DB_DATABASE === 'last132' || process.env.CLOUD_DB_NAME === 'last132') {
    throw new Error('Production database environment detected; refusing to run');
  }
  const host = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = process.env.DRVO_STAGING_DB_PORT || '14330';
  Object.assign(process.env, {
    DB_SERVER: host, DB_PORT: port, DB_DATABASE: EXPECTED_DB, DB_USER: EXPECTED_LOGIN,
    DB_PASSWORD: password, DB_ENCRYPT: 'false', DB_TRUST_SERVER_CERTIFICATE: 'true',
    CLOUD_DB_SERVER: host, CLOUD_DB_PORT: port, CLOUD_DB_NAME: EXPECTED_DB,
    CLOUD_DB_USER: EXPECTED_LOGIN, CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false', CLOUD_DB_TRUST_CERT: 'true',
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  });
  return {
    server: host, port: Number(port), database: EXPECTED_DB,
    user: EXPECTED_LOGIN, password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 120000,
  } satisfies sql.config;
}

async function assertStaging(pool: sql.ConnectionPool) {
  const result = await pool.request().query("SELECT DB_NAME() AS databaseName, SUSER_SNAME() AS loginName");
  const identity = result.recordset[0];
  check(identity?.databaseName === EXPECTED_DB, 'Connected to last132_agent only');
  check(String(identity?.loginName).toLowerCase() === EXPECTED_LOGIN, 'Using drvo_agent only');
}

function futureDate(days: number): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const date = new Date(today + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Libraries used by the booking stack may keep pooled SQL requests/handles alive
 * after the complete staging proof. Closing is best-effort only AFTER tenant
 * cleanup has been verified; do not hang the job just to drain test connections.
 */
async function closeSmokePool(pool: sql.ConnectionPool, maxWaitMs = 12_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pool.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SQL pool close deadline exceeded')), maxWaitMs);
      }),
    ]);
    console.log('PASS: Smoke SQL pool closed');
  } catch (err) {
    console.warn(
      'WARN: Test SQL pool did not close cleanly after cleanup:',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const config = forceStagingConfig();
  const pool = await sql.connect(config);
  let tenantCode: string | null = null;
  let booked = false;
  let syntheticInvoiceId: number | null = null;
  let syntheticBranchId: number | null = null;
  try {
    await assertStaging(pool);
    // Dynamic imports happen after staging-only environment and DB identity checks.
    const { parsePublicSignupInput, buildOnboardingRequest } = await import('../../src/platform/publicSignup/service');
    const { findIndustryPack } = await import('../../src/packs');
    const { onboardBusiness, defaultOnboardingDeps } = await import('../../src/platform/onboarding/wizard/coordinator');
    const { saveEmployeeBranchWeeklySchedule } = await import('../../src/lib/hr/employeeBranchScheduleSave');
    const { getPublicBookingServicesCatalog } = await import('../../src/lib/booking/publicBookingServices');
    const { getPublicAvailableSlots } = await import('../../src/lib/booking/publicBookingAvailability');
    const { evaluatePublicBookingSelection } = await import('../../src/lib/booking/publicBookingSelectionEvaluator');
    const { createPublicBooking } = await import('../../src/lib/booking/publicBookingCreate');
    const { reschedulePublicBooking } = await import('../../src/lib/booking/publicBookingReschedule');
    const { cancelPublicBooking } = await import('../../src/lib/booking/publicBookingCancellation');
    const { convertBooking } = await import('../../src/apps/booking/application/convertBooking');
    const { resolvePublicBookingBranchContext, invalidatePublicBookingBranchContextCache } = await import('../../src/lib/booking/publicBookingBranchContext');
    const { invalidatePublicBookingTenancyCache } = await import('../../src/lib/booking/publicBookingTenancy');
    const { invalidatePublicSettingsCache } = await import('../../src/lib/publicBookingHelpers');
    const { resetTenantAccessGate } = await import('../../src/platform/commercial/tenantAccessGate');

    const input = parsePublicSignupInput({
      industry: 'salon', needs: ['booking'], contactName: 'Salon QA Owner',
      businessName: 'DRVO Salon Booking Acceptance', phone: SMOKE_PHONE,
      password: 'StagingOnlyPass123!', startMode: 'demo',
    });
    const req = buildOnboardingRequest(input);
    tenantCode = req.business.tenantCode;
    check(req.branches[0].branchName !== 'الفرع الرئيسي', 'Branch name is signup-specific');
    check(req.services.length > 0 && req.employees.length > 0, 'Salon demo includes services and barbers');
    req.subscription = { planCode: 'starter', status: 'active' };
    const actors = await pool.request().query("SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted,0)=0 ORDER BY UserID");
    check(actors.recordset.length === 1, 'Onboarding actor exists in staging');
    const actor = { actorUserId: Number(actors.recordset[0].UserID), actorUserName: 'salon-e2e-staging' };
    const onboarding = await onboardBusiness(req, actor, defaultOnboardingDeps(findIndustryPack));
    check(onboarding.complete, 'Tenant onboarding stages completed');
    const tenantId = onboarding.core.tenantId;
    const branchCode = onboarding.core.branchCode;
    // Resolve the new branch through its tenant-owned Location.
    const owned = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('branchCode', sql.NVarChar(30), branchCode).query(`SELECT LegacyBranchId AS branchId FROM dbo.Location WHERE TenantId=@tenantId AND BranchCode=@branchCode`);
    check(owned.recordset.length === 1, 'New branch is owned by the fresh tenant');
    const branchId = Number(owned.recordset[0].branchId);
    syntheticBranchId = branchId;
    const staff = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('name', sql.NVarChar(200), req.employees[0].name)
      .query("SELECT EmpID FROM dbo.TblEmp WHERE TenantId=@tenantId AND EmpName=@name");
    check(staff.recordset.length === 1, 'New barber belongs to the tenant');
    const empId = Number(staff.recordset[0].EmpID);

    // One controlled staging test roster. Payroll validation is outside booking scope.
    await saveEmployeeBranchWeeklySchedule({
      empId, branchId, effectiveFrom: futureDate(0), skipPayrollCheck: true,
      cells: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek, isWorking: true, startTime: '11:00', endTime: '23:00', canReceiveBookings: true,
      })),
    });
    await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('branchId', sql.Int, branchId).input('branchCode', sql.NVarChar(30), branchCode)
      .query(`UPDATE b SET LifecycleStatus=N'PUBLIC_LIVE', PublicBookingEnabled=1, ExternalNotificationsEnabled=0
        FROM dbo.TblBranch b INNER JOIN dbo.Location l ON l.LegacyBranchId=b.BranchID
        WHERE b.BranchID=@branchId AND b.BranchCode=@branchCode AND l.TenantId=@tenantId;
        UPDATE dbo.QueueBookingSettings SET BookingEnabled=1 WHERE BranchID=@branchId;`);
    resetTenantAccessGate();
    invalidatePublicBookingTenancyCache();
    invalidatePublicBookingBranchContextCache(branchCode);
    invalidatePublicSettingsCache(branchId);

    const branch = await resolvePublicBookingBranchContext({
      branchCode, purpose: 'public_booking', expectedTenantId: tenantId,
    });
    const catalog = await getPublicBookingServicesCatalog(branch);
    const service = catalog.services.find((row) => row.nameEn === 'Hair Cut') ?? catalog.services[0];
    check(service && service.price > 0, 'Fresh salon has bookable service');
    let date: string | null = null;
    let slot: { time: string; dayOffset: 0 | 1; barbers: Array<{ empId: number }> } | null = null;
    for (let offset = 1; offset <= 10; offset++) {
      const candidate = futureDate(offset);
      const slots = await getPublicAvailableSlots({
        branchCode, date: candidate, serviceIds: [service.serviceId], empId, expectedTenantId: tenantId,
      });
      const found = slots.slots.find((s) => s.barbers.some((b) => b.empId === empId));
      if (found) { date = candidate; slot = found; break; }
    }
    check(date && slot, 'Staging barber has public future slot');
    const plan = await evaluatePublicBookingSelection({
      branchCode, date, time: slot.time, dayOffset: slot.dayOffset,
      serviceIds: [service.serviceId], empId, mode: 'specific_barber',
      purpose: 'plan', expectedTenantId: tenantId,
    });
    check(plan.available && plan.planToken, 'Signed booking plan is available');
    const payload = {
      branchCode, date, time: slot.time, dayOffset: slot.dayOffset,
      serviceIds: [service.serviceId], empId, mode: 'specific_barber',
      customer: { name: 'Salon Acceptance Client', phone: SMOKE_PHONE },
      clientRequestId: REQUEST_KEY, planToken: plan.planToken,
      suppressNotification: true, expectedTenantId: tenantId,
    } as const;
    const created = await createPublicBooking(payload);
    check(created.httpStatus === 201 && created.body.booking.id, 'Booking successfully persisted');
    booked = true;
    check(created.body.whatsapp?.scheduled === false, 'No customer WhatsApp scheduled');
    const bookingId = Number(created.body.booking.id);
    const persisted = await pool.request().input('bookingId', sql.Int, bookingId).query(`SELECT BookingID, BranchID, AssignedEmpID FROM dbo.Bookings WHERE BookingID=@bookingId`);
    check(persisted.recordset[0]?.BranchID === branchId, 'Persisted booking uses new salon branch');
    check(persisted.recordset[0]?.AssignedEmpID === empId, 'Persisted booking uses new salon barber');
    // Real SQL security proof: conversion must never read an invoice linked to
    // a foreign tenant or perform writes when ownership is absent.
    const foreignTenantId = crypto.randomUUID();
    const actorFor = (targetTenantId: string) => ({
      actorType: 'staff' as const, actorId: String(actor.actorUserId),
      tenantId: targetTenantId, membershipId: null, viewLocationId: null,
    });
    const fakePorts = (targetTenantId: string) => ({
      tenantId: targetTenantId, actor: actorFor(targetTenantId),
      calendar: {
        resolveFinancialWriteContext: async () => ({
          tenantId: targetTenantId, locationId: branchId, businessDayId: 0,
          businessDate: date, shiftInstanceId: null, scope: 'DAY' as const,
        }),
      },
    }) as unknown as Parameters<typeof convertBooking>[0];
    const foreign = await convertBooking(fakePorts(foreignTenantId), {
      bookingId, locationId: branchId, userId: actor.actorUserId,
    });
    check(!foreign.ok && foreign.status === 404, 'Foreign tenant cannot convert salon booking');
    const sameTenant = await convertBooking(fakePorts(tenantId), {
      bookingId, locationId: branchId, userId: actor.actorUserId,
    });
    check(!sameTenant.ok && sameTenant.status === 400,
      'Owner passes tenant fence but cannot convert without open financial shift');
    const invoiceAfterChecks = await pool.request().input('bookingId', sql.Int, bookingId)
      .query('SELECT ConvertedInvID FROM dbo.Bookings WHERE BookingID=@bookingId');
    check(invoiceAfterChecks.recordset[0]?.ConvertedInvID == null,
      'Unauthorized or shiftless conversion created no invoice association');
    console.log('SALON_CONVERSION_TENANT_ISOLATION_STAGING_PASS');

    // Positive financial flow on disposable staging data only.
    // Booking conversion creates a SERVICE invoice. Payment settlement is a separate contract.
    const { openBusinessDay } = await import('../../src/lib/branch/businessDay');
    const { openShift } = await import('../../src/lib/branch/shiftSession');
    const { buildStaffActorContext, buildBookingSchedulingPorts } =
      await import('../../src/lib/bookingSchedulingComposition');
    const ownerRow = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`SELECT TOP 1 LegacyUserId AS UserID FROM dbo.TenantMembership
        WHERE TenantId=@tenantId AND LegacyUserId IS NOT NULL
        ORDER BY LegacyUserId DESC`);
    const ownerUserId = Number(ownerRow.recordset[0]?.UserID);
    check(ownerUserId > 0, 'Fresh salon owner has a staff identity');
    const branchCtx = {
      userId: ownerUserId, branchId, branchCode,
      branchName: req.branches[0].branchName, shortName: null,
      timeZone: 'Africa/Cairo', businessDayCutoffTime: '04:00',
      tenantId, canOperate: true, canViewReports: true, canSwitch: true,
    };
    const { getBranchBusinessDate, getOpenBusinessDay } =
      await import('../../src/lib/branch/businessDay');
    const businessDate = getBranchBusinessDate(branchCtx);
    const openedDay = await getOpenBusinessDay(branchId) ??
      await openBusinessDay(branchCtx, businessDate);
    check(openedDay.branchId === branchId && openedDay.status,
      'Fresh salon has a real open operational business day');
    const openedShift = await openShift(branchCtx, ownerUserId, 1);
    check(openedShift.branchId === branchId && openedShift.status,
      'Fresh salon owner has a real open financial shift');
    const ownerActor = await buildStaffActorContext(ownerUserId, tenantId);
    const actualPorts = await buildBookingSchedulingPorts(ownerActor);
    const converted = await convertBooking(actualPorts, {
      bookingId, locationId: branchId, userId: ownerUserId,
      idempotencyKey: REQUEST_KEY + '-INVOICE',
    });
    check(converted.ok && converted.invoiceId > 0 && converted.invoiceType === 'خدمة',
      'Booking converted into a real service invoice within financial shift');
    const invId = converted.invoiceId;
    syntheticInvoiceId = invId;
    const invoice = await pool.request().input('id',sql.Int,invId)
      .input('branchId',sql.Int,branchId)
      .query(`SELECT invID, invType, BranchID, BusinessDayID, ShiftMoveID, GrandTotal,
        Payment, isActive FROM dbo.TblinvServHead
        WHERE invID=@id AND invType=N'خدمة' AND BranchID=@branchId`);
    check(invoice.recordset.length === 1 &&
      Number(invoice.recordset[0].BusinessDayID) === openedDay.id &&
      Number(invoice.recordset[0].ShiftMoveID) === openedShift.id,
      'Invoice belongs to correct tenant branch, business day and shift');
    const linked = await pool.request().input('id',sql.Int,bookingId)
      .query('SELECT Status, ConvertedInvID, ConvertedInvType FROM dbo.Bookings WHERE BookingID=@id');
    check(Number(linked.recordset[0]?.ConvertedInvID) === invId &&
      linked.recordset[0]?.ConvertedInvType === 'خدمة',
      'Booking completion references the same invoice');
    const convertedReplay = await convertBooking(actualPorts, {
      bookingId, locationId: branchId, userId: ownerUserId,
      idempotencyKey: REQUEST_KEY + '-INVOICE',
    });
    check(convertedReplay.ok && convertedReplay.idempotentReplay &&
      convertedReplay.invoiceId === invId,
      'Retry returns same invoice without a second conversion');
    const totalInvoices = await pool.request().input('id',sql.Int,invId)
      .query("SELECT COUNT_BIG(*) AS Total FROM dbo.TblinvServHead WHERE invID=@id AND invType=N'خدمة'");
    check(Number(totalInvoices.recordset[0].Total) === 1,
      'Conversion invoice exists exactly once');
    // This adapter currently writes a SERVICE invoice (not a settled sale).
    // No claim about receipt, payroll, or a treasury payment is made here.
    console.log('SALON_BOOKING_SERVICE_INVOICE_STAGING_PASS');
  } finally {
    if (tenantCode) {
      await assertStaging(pool);
      // These idempotency tables are keyed by request ID, not TenantId. Clean
      // only the synthetic keys from this run before the tenant-owned purge.
      for (const [table, key] of [
        ['TblPublicBookingCreateRequest', REQUEST_KEY],
        ['TblPublicBookingRescheduleRequest', REQUEST_KEY + '-MOVE'],
        ['TblPublicBookingCancelRequest', REQUEST_KEY + '-CANCEL'],
      ] as const) {
        try {
          await pool.request().input('key', sql.NVarChar(128), key)
            .query(`DELETE FROM dbo.[${table}] WHERE IdempotencyKey=@key`);
        } catch (err) {
          console.error('Idempotency cleanup warning:', table, err instanceof Error ? err.message : String(err));
        }
      }
      if (syntheticInvoiceId != null && syntheticBranchId != null) {
        // Invoice detail rows lack TenantId/BranchID in the legacy schema.
        // Delete ONLY after proving the header belongs to this disposable tenant.
        const isOwned = await pool.request()
          .input('code', sql.NVarChar(64), tenantCode)
          .input('branchId', sql.Int, syntheticBranchId)
          .input('invId', sql.Int, syntheticInvoiceId)
          .query(`SELECT 1 AS Owned FROM dbo.TblinvServHead h
            JOIN dbo.Location l ON l.LegacyBranchId = h.BranchID
            JOIN dbo.Tenant t ON t.TenantId = l.TenantId
            WHERE t.Code=@code AND h.BranchID=@branchId
              AND h.invID=@invId AND h.invType=N'خدمة'`);
        check(isOwned.recordset.length === 1,
          'Synthetic service invoice ownership revalidated before cleanup');
        await pool.request().input('invId',sql.Int,syntheticInvoiceId)
          .input('branchId',sql.Int,syntheticBranchId)
          .query(`UPDATE dbo.Bookings SET ConvertedInvID=NULL, ConvertedInvType=NULL
            WHERE BranchID=@branchId AND ConvertedInvID=@invId AND ConvertedInvType=N'خدمة'`);
        await pool.request().input('invId',sql.Int,syntheticInvoiceId)
          .query("DELETE FROM dbo.TblinvServDetail WHERE invID=@invId AND invType=N'خدمة'");
        await pool.request().input('invId',sql.Int,syntheticInvoiceId)
          .input('branchId',sql.Int,syntheticBranchId)
          .query(`DELETE FROM dbo.TblinvServHead
            WHERE invID=@invId AND invType=N'خدمة' AND BranchID=@branchId`);
        console.log('PASS: Synthetic service invoice and details cleaned');
      }
      const { purgeSmokeTenant } = await import('./smokeTenantPurge');
      await purgeSmokeTenant(pool, tenantCode);
      const leftover = await pool.request().input('code', sql.NVarChar(64), tenantCode)
        .query('SELECT COUNT(*) AS count FROM dbo.Tenant WHERE Code=@code');
      check(Number(leftover.recordset[0].count) === 0, 'Synthetic salon cleaned completely');
    }
    await closeSmokePool(pool);
    if (!booked) console.error('SALON_BOOKING_E2E_STAGING_INCOMPLETE');
  }
}
// This is a one-off CLI smoke, not a persistent server. Explicitly terminate
// after verified tenant cleanup and bounded pool close; Node/Next may hold open
// background handles even when all booking and cleanup assertions have passed.
void main().then(
  () => {
    console.log('SALON_BOOKING_INVOICE_STAGING_EXIT_OK');
    process.exit(0);
  },
  (err: unknown) => {
    console.error('SALON_BOOKING_INVOICE_STAGING_FAIL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
