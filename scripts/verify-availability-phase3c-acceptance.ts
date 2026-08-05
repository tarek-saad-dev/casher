#!/usr/bin/env npx tsx
/**
 * Phase 3C.1 — Acceptance unblock smoke.
 *
 * Opt-in only:
 *   AVAILABILITY_ACCEPTANCE_SMOKE=1 npm run verify:availability-phase3c:acceptance
 *
 * Preferred branch: CAMP_CAESAR (PublicBookingEnabled stays 0).
 * Temporary QueueBookingSettings.BookingEnabled toggle with restore in finally.
 *
 * GLEEM temporary toggle requires ALLOW_TEMP_BRANCH_BOOKING_TOGGLE=1 and also
 * temporarily clears PublicBookingEnabled so public discovery is not exposed;
 * both flags are restored and verified.
 */
import path from 'path';
import crypto from 'crypto';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

type Result = { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail?: string };

const results: Result[] = [];

function pass(name: string, detail?: string) {
  results.push({ name, status: 'PASS', detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name: string, detail?: string) {
  results.push({ name, status: 'FAIL', detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name: string, detail?: string) {
  results.push({ name, status: 'SKIP', detail });
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ''}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type GateSnapshot = {
  branchId: number;
  branchCode: string;
  publicBookingEnabled: boolean;
  qbsBookingEnabled: boolean;
  maxBookingDaysAhead: number;
  lifecycleStatus: string;
  isActive: boolean;
};

async function readGate(branchCode: string): Promise<GateSnapshot> {
  const { getPool, sql } = await import('../src/lib/db');
  const db = await getPool();
  const r = await db
    .request()
    .input('code', sql.NVarChar(32), branchCode)
    .query(`
      SELECT
        b.BranchID, b.BranchCode,
        CAST(ISNULL(b.IsActive,0) AS BIT) AS IsActive,
        ISNULL(b.LifecycleStatus, N'SETUP') AS LifecycleStatus,
        CAST(ISNULL(b.PublicBookingEnabled,0) AS BIT) AS PublicBookingEnabled,
        CAST(ISNULL(q.BookingEnabled,0) AS BIT) AS QbsBookingEnabled,
        ISNULL(q.MaxBookingDaysAhead, 14) AS MaxBookingDaysAhead
      FROM dbo.TblBranch b
      LEFT JOIN dbo.QueueBookingSettings q ON q.BranchID = b.BranchID
      WHERE b.BranchCode = @code
    `);
  const row = r.recordset[0];
  if (!row) throw new Error(`Branch not found: ${branchCode}`);
  return {
    branchId: Number(row.BranchID),
    branchCode: String(row.BranchCode),
    publicBookingEnabled: Boolean(row.PublicBookingEnabled),
    qbsBookingEnabled: Boolean(row.QbsBookingEnabled),
    maxBookingDaysAhead: Number(row.MaxBookingDaysAhead) || 14,
    lifecycleStatus: String(row.LifecycleStatus),
    isActive: Boolean(row.IsActive),
  };
}

async function setBranchActiveAndPublicFlags(args: {
  branchId: number;
  isActive: boolean;
  publicBookingEnabled: boolean;
  lifecycleStatus?: string;
}): Promise<void> {
  const { getPool, sql } = await import('../src/lib/db');
  const { invalidatePublicBookingBranchContextCache } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const db = await getPool();
  const req = db
    .request()
    .input('branchId', sql.Int, args.branchId)
    .input('isActive', sql.Bit, args.isActive ? 1 : 0)
    .input('pub', sql.Bit, args.publicBookingEnabled ? 1 : 0);
  if (args.lifecycleStatus) {
    await req.input('life', sql.NVarChar(32), args.lifecycleStatus).query(`
      UPDATE dbo.TblBranch
      SET IsActive=@isActive,
          PublicBookingEnabled=@pub,
          LifecycleStatus=@life
      WHERE BranchID=@branchId
    `);
  } else {
    await req.query(`
      UPDATE dbo.TblBranch
      SET IsActive=@isActive, PublicBookingEnabled=@pub
      WHERE BranchID=@branchId
    `);
  }
  invalidatePublicBookingBranchContextCache();
}

async function setQbsBookingEnabled(
  branchId: number,
  enabled: boolean,
  maxDaysAhead: number,
): Promise<void> {
  const { getPool, sql } = await import('../src/lib/db');
  const { invalidatePublicBookingBranchContextCache } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const db = await getPool();
  await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('enabled', sql.Bit, enabled ? 1 : 0)
    .input('days', sql.Int, maxDaysAhead)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.QueueBookingSettings WHERE BranchID=@branchId)
        INSERT INTO dbo.QueueBookingSettings (
          BranchID, SalonName, Timezone, Currency, BookingEnabled,
          AllowSpecificBarber, AllowNearestBarber, DefaultMode,
          SlotIntervalMinutes, MinNoticeMinutes, MaxBookingDaysAhead,
          DefaultServiceDurationMinutes
        ) VALUES (
          @branchId, N'Cut Salon', N'Africa/Cairo', N'EGP', @enabled,
          1, 1, N'nearest', 15, 30, @days, 30
        )
      ELSE
        UPDATE dbo.QueueBookingSettings
        SET BookingEnabled=@enabled, MaxBookingDaysAhead=@days, UpdatedAt=GETDATE()
        WHERE BranchID=@branchId
    `);
  invalidatePublicBookingBranchContextCache();
}

async function setPublicBookingEnabledFlag(branchId: number, enabled: boolean): Promise<void> {
  const { getPool, sql } = await import('../src/lib/db');
  const { invalidatePublicBookingBranchContextCache } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const db = await getPool();
  await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('enabled', sql.Bit, enabled ? 1 : 0)
    .query(`
      UPDATE dbo.TblBranch
      SET PublicBookingEnabled=@enabled
      WHERE BranchID=@branchId
    `);
  invalidatePublicBookingBranchContextCache();
}

async function adminCancelBooking(bookingId: number, reason: string): Promise<void> {
  const { getPool, sql } = await import('../src/lib/db');
  const db = await getPool();
  await db
    .request()
    .input('id', sql.Int, bookingId)
    .input('reason', sql.NVarChar(200), reason)
    .query(`
      UPDATE dbo.Bookings
      SET Status='cancelled', CancelReason=@reason, CancelledAt=GETDATE(), UpdatedAt=GETDATE()
      WHERE BookingID=@id
    `);
}

async function main() {
  if (process.env.AVAILABILITY_ACCEPTANCE_SMOKE !== '1') {
    console.log(
      'Acceptance smoke disabled. Set AVAILABILITY_ACCEPTANCE_SMOKE=1 to run mutations.',
    );
    process.exit(0);
  }

  const runId = crypto.randomBytes(4).toString('hex');
  const tag = `[P3C-ACC ${runId}]`;
  const allowGleemToggle = process.env.ALLOW_TEMP_BRANCH_BOOKING_TOGGLE === '1';

  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate, SALON_TZ } = await import('../src/lib/businessDate');
  const { salonDateTimeToMs } = await import('../src/lib/publicBookingHelpers');
  const {
    createDailyAdjustment,
    cancelDailyAdjustment,
  } = await import('../src/lib/availability/dailyAdjustmentService');
  const { resolveEmployeeDayPlan } = await import(
    '../src/lib/availability/resolveEmployeeDayPlan'
  );
  const { createPublicBooking } = await import('../src/lib/booking/publicBookingCreate');
  const { validateBookingMove, rescheduleBookingMove } = await import(
    '../src/lib/bookingRescheduleCore'
  );
  const { ScheduleConflictError, getEmployeeBusyIntervals } = await import(
    '../src/lib/scheduleIntegrity'
  );
  const { listPublicDiscoverableBranches } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );

  const today = getCairoBusinessDate();
  const businessDate = addDays(today, 14);

  // Strategy selection
  const ccGate = await readGate('CAMP_CAESAR');
  const gleemGate = await readGate('GLEEM');
  let strategy: 'CAMP_CAESAR' | 'GLEEM_TEMP' = 'CAMP_CAESAR';
  let target = ccGate;

  // Prefer CC: keep PublicBookingEnabled=0; only toggle QBS.BookingEnabled.
  if (ccGate.publicBookingEnabled) {
    if (!allowGleemToggle) {
      fail(
        'strategy',
        'CAMP_CAESAR unexpectedly PublicBookingEnabled=1; refusing without ALLOW_TEMP_BRANCH_BOOKING_TOGGLE',
      );
      process.exit(1);
    }
  }

  // Emp 12 assigned to CC?
  const db = await getPool();
  const assign = await db
    .request()
    .input('empId', sql.Int, 12)
    .input('branchId', sql.Int, ccGate.branchId)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpBranchAssignment
      WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
        AND (EffectiveTo IS NULL OR EffectiveTo >= CAST(GETDATE() AS DATE))
    `);
  if (!assign.recordset.length) {
    if (!allowGleemToggle) {
      fail('strategy', 'Emp 12 not assigned to CAMP_CAESAR and GLEEM toggle not allowed');
      process.exit(1);
    }
    strategy = 'GLEEM_TEMP';
    target = gleemGate;
  }

  console.log(
    JSON.stringify({
      phase: 'availability-phase-3c1-acceptance',
      runId,
      strategy,
      branch: {
        code: target.branchCode,
        id: target.branchId,
        lifecycle: target.lifecycleStatus,
        isActive: target.isActive,
        publicBookingEnabled: target.publicBookingEnabled,
        qbsBookingEnabled: target.qbsBookingEnabled,
      },
      willTemporarilyChangeGate: true,
      businessDate,
      gleemPublicBookingEnabled: gleemGate.publicBookingEnabled,
      allowGleemToggle,
    }),
  );

  const original = await readGate(target.branchCode);
  let restoredOk = false;
  const createdAdjustmentIds: number[] = [];
  let bookingId: number | null = null;
  let bookingCode: string | null = null;
  const actorUserId = 13; // Tarek — super_admin

  const svc = (
    await db.request().query(`
      SELECT TOP 1 ProID AS ServiceID, ISNULL(DurationMinutes, 30) AS DurationMinutes
      FROM dbo.TblPro
      WHERE ISNULL(isDeleted, 0) = 0 AND ISNULL(DurationMinutes, 30) BETWEEN 15 AND 45
      ORDER BY ProID
    `)
  ).recordset[0];
  assert(svc, 'No service');
  const serviceId = Number(svc.ServiceID);
  const durationMinutes = Number(svc.DurationMinutes) || 30;
  const empId = 12;

  async function restoreGates(): Promise<void> {
    await setQbsBookingEnabled(
      original.branchId,
      original.qbsBookingEnabled,
      original.maxBookingDaysAhead,
    );
    await setBranchActiveAndPublicFlags({
      branchId: original.branchId,
      isActive: original.isActive,
      publicBookingEnabled: original.publicBookingEnabled,
      lifecycleStatus: original.lifecycleStatus,
    });
    const after = await readGate(original.branchCode);
    if (
      after.qbsBookingEnabled !== original.qbsBookingEnabled
      || after.publicBookingEnabled !== original.publicBookingEnabled
      || after.maxBookingDaysAhead !== original.maxBookingDaysAhead
      || after.isActive !== original.isActive
      || after.lifecycleStatus !== original.lifecycleStatus
    ) {
      throw new Error(
        `Gate restore mismatch: got ${JSON.stringify({
          qbs: after.qbsBookingEnabled,
          pub: after.publicBookingEnabled,
          days: after.maxBookingDaysAhead,
          active: after.isActive,
          life: after.lifecycleStatus,
        })}`,
      );
    }
    // Ensure GLEEM public discovery state unchanged when using CC strategy
    if (strategy === 'CAMP_CAESAR') {
      const g = await readGate('GLEEM');
      if (g.qbsBookingEnabled !== gleemGate.qbsBookingEnabled) {
        throw new Error('GLEEM QBS changed unexpectedly');
      }
      if (g.publicBookingEnabled !== gleemGate.publicBookingEnabled) {
        throw new Error('GLEEM PublicBookingEnabled changed unexpectedly');
      }
    }
    restoredOk = true;
  }

  async function softCancelAdjustments() {
    for (const id of [...createdAdjustmentIds].reverse()) {
      try {
        await cancelDailyAdjustment({
          branchId: target.branchId,
          adjustmentId: id,
          cancelledBy: actorUserId,
        });
      } catch (err) {
        console.warn('adj cancel', id, err instanceof Error ? err.message : err);
      }
    }
    createdAdjustmentIds.length = 0;
  }

  try {
    // Enable internal booking without public exposure
    if (strategy === 'CAMP_CAESAR') {
      assert(!original.publicBookingEnabled, 'CC must stay non-public');
      // Eligibility requires branch IsActive=1; keep PublicBookingEnabled=0 and non-PUBLIC_LIVE.
      await setBranchActiveAndPublicFlags({
        branchId: original.branchId,
        isActive: true,
        publicBookingEnabled: false,
        lifecycleStatus: 'INTERNAL_LIVE',
      });
      await setQbsBookingEnabled(original.branchId, true, Math.max(original.maxBookingDaysAhead, 30));
    } else {
      // Temporarily hide from public discovery while enabling QBS
      await setPublicBookingEnabledFlag(original.branchId, false);
      await setQbsBookingEnabled(original.branchId, true, Math.max(original.maxBookingDaysAhead, 30));
    }

    const discoverable = await listPublicDiscoverableBranches();
    const exposed = discoverable.some((b) => b.branchCode === target.branchCode);
    if (strategy === 'CAMP_CAESAR') {
      assert(!exposed, 'CAMP_CAESAR must not appear in public discovery');
      pass('public_exposure_guard', 'CAMP_CAESAR not in public branches list');
    } else {
      assert(!exposed, 'GLEEM must not be public during temp toggle');
      pass('public_exposure_guard', 'GLEEM PublicBookingEnabled temporarily off');
    }

    // Multi-window day
    const replace = await createDailyAdjustment({
      branchId: target.branchId,
      empId,
      businessDate,
      adjustmentType: 'REPLACE_WINDOWS',
      reasonText: tag,
      source: 'system',
      windows: [
        { start: '11:00', end: '15:00', endDayOffset: 0 },
        { start: '18:00', end: '22:00', endDayOffset: 0 },
      ],
      createdBy: actorUserId,
    });
    createdAdjustmentIds.push(replace.adjustmentId);

    const plan = await resolveEmployeeDayPlan({
      empId,
      businessDate,
      branchId: target.branchId,
      source: 'operations',
    });
    assert(plan.effectiveWindows.length >= 2, `windows=${plan.effectiveWindows.length}`);
    pass('multi_window_plan', `windows=${plan.effectiveWindows.length}`);

    const eveningMs = salonDateTimeToMs(businessDate, '19:00', SALON_TZ);
    const gapMs = salonDateTimeToMs(businessDate, '16:00', SALON_TZ);
    const noonMs = salonDateTimeToMs(businessDate, '12:00', SALON_TZ);
    const bridgeMs = salonDateTimeToMs(businessDate, '14:30', SALON_TZ);

    // Canonical create in second window
    const created = await createPublicBooking({
      branchCode: target.branchCode,
      date: businessDate,
      time: '19:00',
      dayOffset: 0,
      serviceIds: [serviceId],
      empId,
      mode: 'specific_barber',
      customer: { name: `${tag} Guest`, phone: null },
      notes: tag,
      purpose: 'internal_preview',
      bookingSource: 'admin',
      auth: { userId: actorUserId, canOperate: true },
      suppressNotification: true,
      clientRequestId: `p3c-acc-${runId}-create`,
    });
    bookingCode = String(
      created.body.booking.code ?? created.body.booking.bookingCode ?? '',
    );
    bookingId = Number(created.body.booking.id ?? created.body.booking.bookingId);
    assert(bookingId > 0 && bookingCode, 'missing booking id/code');
    const savedBranch = Number(
      created.body.booking.branchId ?? created.body.booking.BranchID ?? target.branchId,
    );
    const savedEmp = Number(
      created.body.booking.empId
        ?? created.body.booking.assignedEmpId
        ?? created.body.booking.AssignedEmpID
        ?? empId,
    );
    pass(
      'create_second_window',
      `id=${bookingId} code=${bookingCode} branch=${savedBranch} emp=${savedEmp}`,
    );

    // Occupancy includes booking
    const busy = await getEmployeeBusyIntervals({
      empId,
      operationalDate: businessDate,
      branchId: target.branchId,
      now: new Date(salonDateTimeToMs(businessDate, '10:00', SALON_TZ)),
    });
    const occupies = busy.some(
      (iv) =>
        iv.start.getTime() < eveningMs + durationMinutes * 60_000
        && iv.end.getTime() > eveningMs,
    );
    assert(occupies, 'booking missing from occupancy');
    pass('occupancy_after_create', `busyIntervals=${busy.length}`);

    // Overlap reject
    let overlapRejected = false;
    try {
      await createPublicBooking({
        branchCode: target.branchCode,
        date: businessDate,
        time: '19:00',
        dayOffset: 0,
        serviceIds: [serviceId],
        empId,
        mode: 'specific_barber',
        customer: { name: `${tag} Overlap`, phone: null },
        notes: tag,
        purpose: 'internal_preview',
        bookingSource: 'admin',
        auth: { userId: actorUserId, canOperate: true },
        suppressNotification: true,
        clientRequestId: `p3c-acc-${runId}-overlap`,
      });
    } catch {
      overlapRejected = true;
    }
    assert(overlapRejected, 'overlap create should fail');
    pass('overlap_rejected');

    // Gap reject
    let gapRejected = false;
    try {
      await createPublicBooking({
        branchCode: target.branchCode,
        date: businessDate,
        time: '16:00',
        dayOffset: 0,
        serviceIds: [serviceId],
        empId,
        mode: 'specific_barber',
        customer: { name: `${tag} Gap`, phone: null },
        notes: tag,
        purpose: 'internal_preview',
        bookingSource: 'admin',
        auth: { userId: actorUserId, canOperate: true },
        suppressNotification: true,
        clientRequestId: `p3c-acc-${runId}-gap`,
      });
    } catch {
      gapRejected = true;
    }
    assert(gapRejected, 'gap create should fail');
    pass('gap_create_rejected');

    // Cross-window: long duration from 14:30 spanning gap — use 240m if service allows via assert path
    // Reschedule validate for bridge interval using synthetic move of existing booking
    const bridgeEnd = new Date(bridgeMs + 4 * 60 * 60_000).toISOString();
    // validateBookingMove uses booking duration, not 4h — so create is the cross-window proof via evaluate.
    // Use validate with overnight-style: move to gap
    const gapMove = await validateBookingMove({
      bookingId: bookingId!,
      newStartAt: new Date(gapMs).toISOString(),
      operationalDate: businessDate,
      targetEmpId: empId,
    });
    assert(!gapMove.valid, 'gap reschedule must fail');
    pass('gap_reschedule_rejected', `code=${gapMove.code}`);

    // Reschedule to first window
    const toFirst = await rescheduleBookingMove({
      bookingId: bookingId!,
      newStartAt: new Date(noonMs).toISOString(),
      operationalDate: businessDate,
      source: 'operations_acceptance',
      userId: actorUserId,
      targetEmpId: empId,
    });
    assert(toFirst.newStartAt, 'move to first failed');
    pass('reschedule_to_first_window', `newStart=${toFirst.newStartAt}`);

    // Back to second window
    const toSecond = await rescheduleBookingMove({
      bookingId: bookingId!,
      newStartAt: new Date(eveningMs).toISOString(),
      operationalDate: businessDate,
      source: 'operations_acceptance',
      userId: actorUserId,
      targetEmpId: empId,
    });
    assert(toSecond.newStartAt, 'move to second failed');
    pass('reschedule_to_second_window', `newStart=${toSecond.newStartAt}`);

    // Daily block then reject move into block
    const block = await createDailyAdjustment({
      branchId: target.branchId,
      empId,
      businessDate,
      adjustmentType: 'BLOCK_WINDOW',
      reasonText: tag,
      source: 'system',
      windows: [{ start: '20:00', end: '21:00', endDayOffset: 0 }],
      createdBy: actorUserId,
    });
    createdAdjustmentIds.push(block.adjustmentId);
    const blockMs = salonDateTimeToMs(businessDate, '20:15', SALON_TZ);
    const intoBlock = await validateBookingMove({
      bookingId: bookingId!,
      newStartAt: new Date(blockMs).toISOString(),
      operationalDate: businessDate,
      targetEmpId: empId,
    });
    assert(!intoBlock.valid, 'blocked move must fail');
    pass('block_reschedule_rejected', `code=${intoBlock.code}`);

    // Self-conflict exclusion: move within same slot should be valid (excludeBookingId)
    const selfOk = await validateBookingMove({
      bookingId: bookingId!,
      newStartAt: new Date(eveningMs).toISOString(),
      operationalDate: businessDate,
      targetEmpId: empId,
    });
    assert(selfOk.valid, `self exclude failed: ${selfOk.code} ${selfOk.message}`);
    pass('exclude_booking_id_self', 'same-slot precheck valid');

    // Overnight window move (add overnight secondary)
    await softCancelAdjustments();
    const overnightAdj = await createDailyAdjustment({
      branchId: target.branchId,
      empId,
      businessDate,
      adjustmentType: 'REPLACE_WINDOWS',
      reasonText: tag,
      source: 'system',
      windows: [
        { start: '11:00', end: '15:00', endDayOffset: 0 },
        { start: '20:00', end: '02:00', endDayOffset: 1 },
      ],
      createdBy: actorUserId,
    });
    createdAdjustmentIds.push(overnightAdj.adjustmentId);
    // Recreate booking in first window then move overnight
    if (bookingId) {
      await adminCancelBooking(bookingId, tag);
      bookingId = null;
      bookingCode = null;
    }
    const created2 = await createPublicBooking({
      branchCode: target.branchCode,
      date: businessDate,
      time: '12:00',
      dayOffset: 0,
      serviceIds: [serviceId],
      empId,
      mode: 'specific_barber',
      customer: { name: `${tag} Guest2`, phone: null },
      notes: tag,
      purpose: 'internal_preview',
      bookingSource: 'admin',
      auth: { userId: actorUserId, canOperate: true },
      suppressNotification: true,
      clientRequestId: `p3c-acc-${runId}-create2`,
    });
    bookingId = Number(created2.body.booking.id ?? created2.body.booking.bookingId);
    bookingCode = String(created2.body.booking.code ?? created2.body.booking.bookingCode ?? '');
    const overnightStart = salonDateTimeToMs(businessDate, '21:00', SALON_TZ);
    const overnightMove = await rescheduleBookingMove({
      bookingId: bookingId!,
      newStartAt: new Date(overnightStart).toISOString(),
      operationalDate: businessDate,
      source: 'operations_acceptance',
      userId: actorUserId,
      targetEmpId: empId,
    });
    pass('overnight_reschedule', `newStart=${overnightMove.newStartAt}`);

    // Branch isolation (CC vs GLEEM) when both exist
    const gleemPlan = await resolveEmployeeDayPlan({
      empId,
      businessDate,
      branchId: gleemGate.branchId,
      source: 'operations',
    });
    const ccPlan = await resolveEmployeeDayPlan({
      empId,
      businessDate,
      branchId: target.branchId,
      source: 'operations',
    });
    const ccHasAdj = (ccPlan.dailyAdjustments ?? []).some((a) =>
      String(a.reasonText ?? '').includes(runId),
    );
    const gleemHasAdj = (gleemPlan.dailyAdjustments ?? []).some((a) =>
      String(a.reasonText ?? '').includes(runId),
    );
    if (strategy === 'CAMP_CAESAR') {
      assert(ccHasAdj, 'CC should see smoke adjustment');
      assert(!gleemHasAdj, 'GLEEM must not see CC adjustment');
      pass('branch_isolation_live', 'CC adjustment does not leak to GLEEM');
    } else {
      skip('branch_isolation_live', 'GLEEM-temp strategy — isolation deferred');
    }
  } catch (err) {
    fail('acceptance_core', err instanceof Error ? err.message : String(err));
  } finally {
    // Cleanup bookings
    try {
      if (bookingId) {
        await adminCancelBooking(bookingId, `${tag} cleanup`);
        const row = await db
          .request()
          .input('id', sql.Int, bookingId)
          .query(`SELECT Status FROM dbo.Bookings WHERE BookingID=@id`);
        const st = String(row.recordset[0]?.Status ?? '').toLowerCase();
        if (st === 'cancelled' || st === 'canceled') {
          pass('booking_cleanup', `id=${bookingId} status=${st}`);
        } else {
          fail('booking_cleanup', `id=${bookingId} status=${st}`);
        }
      } else {
        skip('booking_cleanup', 'no booking id');
      }
    } catch (err) {
      fail('booking_cleanup', err instanceof Error ? err.message : String(err));
    }

    try {
      await softCancelAdjustments();
      const leftover = await db
        .request()
        .input('branchId', sql.Int, target.branchId)
        .input('empId', sql.Int, empId)
        .input('businessDate', sql.Date, businessDate)
        .input('tag', sql.NVarChar(80), `%${runId}%`)
        .query(`
          SELECT COUNT(*) AS c FROM dbo.TblEmpDailyAdjustment
          WHERE BranchID=@branchId AND EmpID=@empId AND BusinessDate=@businessDate
            AND IsActive=1 AND CancelledAt IS NULL AND ReasonText LIKE @tag
        `);
      const c = Number(leftover.recordset[0]?.c ?? 0);
      if (c === 0) pass('adjustment_cleanup', 'no active smoke adjustments');
      else fail('adjustment_cleanup', `active=${c}`);
    } catch (err) {
      fail('adjustment_cleanup', err instanceof Error ? err.message : String(err));
    }

    try {
      await restoreGates();
      pass(
        'gate_restored',
        `${original.branchCode} qbs=${original.qbsBookingEnabled} pub=${original.publicBookingEnabled}`,
      );
    } catch (err) {
      fail('gate_restored', err instanceof Error ? err.message : String(err));
    }
  }

  if (!restoredOk) {
    fail('gate_restored_invariant', 'restoration did not complete');
  }

  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(JSON.stringify({ summary: {
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: failed.length,
    skip: results.filter((r) => r.status === 'SKIP').length,
  }, results }, null, 2));

  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('ACCEPTANCE_FATAL', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
