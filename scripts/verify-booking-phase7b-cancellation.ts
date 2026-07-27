#!/usr/bin/env npx tsx
/**
 * Booking Phase 7B — live cancellation proof (ownership, idempotency, slot release, overnight).
 * BOOKING_PHASE_7B_VERIFIER=enabled npx tsx scripts/verify-booking-phase7b-cancellation.ts
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

process.env.BOOKING_PHASE_6C_VERIFIER = process.env.BOOKING_PHASE_6C_VERIFIER || 'enabled';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function ymdOf(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

async function main() {
  if (process.env.BOOKING_PHASE_7B_VERIFIER !== 'enabled') {
    console.log('Set BOOKING_PHASE_7B_VERIFIER=enabled to run.');
    process.exit(2);
  }

  const { getPool, sql } = await import('../src/lib/db');
  const {
    initPhase6CSmokeContext,
    setupDisposableBarberPair,
    runCreate,
    runCreateInSmokeContext,
    cleanupPhase6C,
    completeSmokeRun,
    P6C_MARKER,
  } = await import('../src/lib/__tests__/helpers/phase6cSmokeHarness');
  const {
    cancelPublicBooking,
    PublicBookingCancelError,
  } = await import('../src/lib/booking/publicBookingCancellation');
  const {
    getPublicBookingByCode,
    listPublicUpcomingBookings,
  } = await import('../src/lib/booking/publicBookingReader');
  const { mintBookingAccessToken } = await import('../src/lib/booking/publicBookingAccessToken');
  const { buildBookingIntervals } = await import('../src/lib/queueEstimateEngine');

  const ctx = await initPhase6CSmokeContext();
  const workDate = '2026-12-29';
  // Overnight-capable shift on the opening work date (covers 00:15 dayOffset=1).
  const { empX } = await setupDisposableBarberPair(ctx, workDate, '08:00', '02:00');

  await ctx.db
    .request()
    .input('branchId', sql.Int, ctx.gleemBranchId)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );

  const phone = '01088886666';
  const serviceIds = ctx.serviceProIds.slice(0, 1);
  const proofs: Record<string, unknown> = {};
  const db = await getPool();

  async function makePublicBooking(args: {
    date: string;
    time: string;
    dayOffset: 0 | 1;
    empId: number;
    key: string;
  }) {
    const created = await runCreateInSmokeContext(ctx, () =>
      runCreate({
        branchCode: 'GLEEM',
        date: args.date,
        time: args.time,
        dayOffset: args.dayOffset,
        serviceIds,
        empId: args.empId,
        mode: 'specific_barber',
        customerName: `${P6C_MARKER} Phase7B`,
        customerPhone: phone,
        idempotencyKey: args.key,
        suppressNotification: true,
      }),
    );
    assert(created.ok, `create failed: ${created.code}`);
    ctx.disposable.bookingCodes.push(created.code);
    ctx.disposable.idempotencyKeys.push(args.key);
    // Strip SMOKE notes so public-origin policy accepts (Source=online).
    await db
      .request()
      .input('code', sql.NVarChar, created.code)
      .input(
        'notes',
        sql.NVarChar,
        `[p6] workDate=${args.date};dayOffset=${args.dayOffset}`,
      )
      .query(`UPDATE dbo.Bookings SET Notes=@notes, Source=N'online' WHERE BookingCode=@code`);
    return created;
  }

  // ── 1. Valid phone cancel + slot release ──────────────────────────
  const key1 = `P7B-C1-${crypto.randomUUID()}`;
  const b1 = await makePublicBooking({
    date: workDate,
    time: '15:00',
    dayOffset: 0,
    empId: empX,
    key: key1,
  });

  const head1 = await db
    .request()
    .input('code', sql.NVarChar, b1.code)
    .query(`SELECT BookingID, AssignedEmpID, BookingDate FROM dbo.Bookings WHERE BookingCode=@code`);
  const bookingId1 = Number(head1.recordset[0].BookingID);
  const empId1 = Number(head1.recordset[0].AssignedEmpID);
  const calendar1 = String(head1.recordset[0].BookingDate).slice(0, 10);

  const beforeBusy = await buildBookingIntervals(db, empId1, workDate, 30);
  const beforeBusyCal = await buildBookingIntervals(db, empId1, calendar1, 30);
  proofs.slot_blocked_before = beforeBusy.some((i) => i.id === bookingId1) ||
    beforeBusyCal.some((i) => i.id === bookingId1);

  const cancelKey1 = `P7B-X1-${crypto.randomUUID()}`;
  const cancel1 = await cancelPublicBooking({
    code: b1.code,
    phone,
    reasonCode: 'customer_changed_plans',
    clientRequestId: cancelKey1,
    idempotencyKey: cancelKey1,
  });
  proofs.phone_cancel_ok =
    cancel1.body.ok === true &&
    cancel1.body.cancellation.status === 'cancelled' &&
    cancel1.body.cancellation.idempotentReplay === false;
  proofs.slot_release_removed = cancel1.body.slotRelease.bookingBlockRemoved === true;
  ctx.disposable.idempotencyKeys.push(cancelKey1);

  const afterBusy = await buildBookingIntervals(db, empId1, workDate, 30);
  const afterBusyCal = await buildBookingIntervals(db, empId1, calendar1, 30);
  proofs.slot_unblocked_after =
    !afterBusy.some((i) => i.id === bookingId1) &&
    !afterBusyCal.some((i) => i.id === bookingId1);

  const lookupCancelled = await getPublicBookingByCode({ code: b1.code, phone });
  proofs.lookup_cancelled =
    lookupCancelled.booking.status === 'cancelled' &&
    lookupCancelled.booking.canCancel === false;

  const upcoming = await listPublicUpcomingBookings({ phone, limit: 25 });
  proofs.upcoming_excludes = !upcoming.bookings.some((b) => b.code === b1.code);

  // Same-key replay
  const replay = await cancelPublicBooking({
    code: b1.code,
    phone,
    reasonCode: 'customer_changed_plans',
    clientRequestId: cancelKey1,
    idempotencyKey: cancelKey1,
  });
  proofs.same_key_replay = replay.body.cancellation.idempotentReplay === true;

  // Already cancelled different key
  const cancelKey1b = `P7B-X1b-${crypto.randomUUID()}`;
  const already = await cancelPublicBooking({
    code: b1.code,
    phone,
    clientRequestId: cancelKey1b,
    idempotencyKey: cancelKey1b,
  });
  proofs.already_cancelled_idempotent =
    already.body.cancellation.alreadyCancelled === true ||
    already.body.cancellation.status === 'cancelled';
  ctx.disposable.idempotencyKeys.push(cancelKey1b);

  // Wrong phone
  let wrongPhone = false;
  try {
    await cancelPublicBooking({
      code: b1.code,
      phone: '01011112222',
      clientRequestId: `P7B-WP-${crypto.randomUUID()}`,
    });
  } catch (e) {
    wrongPhone =
      e instanceof PublicBookingCancelError && e.code === 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED';
  }
  proofs.wrong_phone = wrongPhone;

  // Code only
  let codeOnly = false;
  try {
    await cancelPublicBooking({
      code: b1.code,
      clientRequestId: `P7B-CO-${crypto.randomUUID()}`,
    });
  } catch (e) {
    codeOnly =
      e instanceof PublicBookingCancelError && e.code === 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED';
  }
  proofs.code_only_rejected = codeOnly;

  // Numeric ID
  let numericId = false;
  try {
    await cancelPublicBooking({
      code: String(bookingId1),
      phone,
      clientRequestId: `P7B-NUM-${crypto.randomUUID()}`,
    });
  } catch (e) {
    numericId =
      e instanceof PublicBookingCancelError && e.code === 'INVALID_BOOKING_CODE';
  }
  proofs.numeric_id_rejected = numericId;

  // ── 2. Token cancel ───────────────────────────────────────────────
  const key2 = `P7B-C2-${crypto.randomUUID()}`;
  const b2 = await makePublicBooking({
    date: workDate,
    time: '16:00',
    dayOffset: 0,
    empId: empX,
    key: key2,
  });
  const token = mintBookingAccessToken({
    bookingCode: b2.code,
    normalizedPhone: phone,
  }).token;
  const cancelKey2 = `P7B-X2-${crypto.randomUUID()}`;
  const cancel2 = await cancelPublicBooking({
    code: b2.code,
    accessToken: token,
    clientRequestId: cancelKey2,
    idempotencyKey: cancelKey2,
  });
  proofs.token_cancel_ok = cancel2.body.ok === true;
  ctx.disposable.idempotencyKeys.push(cancelKey2);

  let tokenMismatch = false;
  try {
    await cancelPublicBooking({
      code: b2.code,
      accessToken: mintBookingAccessToken({
        bookingCode: 'BK-OTHER9',
        normalizedPhone: phone,
      }).token,
      clientRequestId: `P7B-TM-${crypto.randomUUID()}`,
    });
  } catch (e) {
    tokenMismatch =
      e instanceof PublicBookingCancelError &&
      (e.code === 'BOOKING_ACCESS_TOKEN_INVALID' ||
        e.code === 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
  }
  proofs.token_mismatch = tokenMismatch;

  // ── 3. Concurrent same-key / different-key ────────────────────────
  const key3 = `P7B-C3-${crypto.randomUUID()}`;
  const b3 = await makePublicBooking({
    date: workDate,
    time: '17:00',
    dayOffset: 0,
    empId: empX,
    key: key3,
  });
  const sameKey = `P7B-CONC-SAME-${crypto.randomUUID()}`;
  const [cA, cB] = await Promise.all([
    cancelPublicBooking({
      code: b3.code,
      phone,
      reasonCode: 'other',
      clientRequestId: sameKey,
      idempotencyKey: sameKey,
    }),
    cancelPublicBooking({
      code: b3.code,
      phone,
      reasonCode: 'other',
      clientRequestId: sameKey,
      idempotencyKey: sameKey,
    }).catch((e) => e),
  ]);
  const sameKeyOk =
    (cA.body?.ok === true || cA instanceof PublicBookingCancelError) &&
    (cB.body?.ok === true ||
      (cB instanceof PublicBookingCancelError &&
        (cB.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS' || cB.code === 'BOOKING_LOCK_TIMEOUT')));
  // At least one success; DB single cancelled
  const st3 = await db
    .request()
    .input('code', sql.NVarChar, b3.code)
    .query(`SELECT Status, PublicCancelledAtUtc FROM dbo.Bookings WHERE BookingCode=@code`);
  proofs.concurrent_same_key_status =
    String(st3.recordset[0].Status).toLowerCase() === 'cancelled';
  proofs.concurrent_same_key_race_handled = sameKeyOk || proofs.concurrent_same_key_status;
  ctx.disposable.idempotencyKeys.push(sameKey);

  const key4 = `P7B-C4-${crypto.randomUUID()}`;
  const b4 = await makePublicBooking({
    date: workDate,
    time: '18:00',
    dayOffset: 0,
    empId: empX,
    key: key4,
  });
  const kDiffA = `P7B-DIFF-A-${crypto.randomUUID()}`;
  const kDiffB = `P7B-DIFF-B-${crypto.randomUUID()}`;
  const [dA, dB] = await Promise.all([
    cancelPublicBooking({
      code: b4.code,
      phone,
      clientRequestId: kDiffA,
      idempotencyKey: kDiffA,
    }),
    cancelPublicBooking({
      code: b4.code,
      phone,
      clientRequestId: kDiffB,
      idempotencyKey: kDiffB,
    }),
  ]);
  proofs.concurrent_diff_keys =
    dA.body.ok === true &&
    dB.body.ok === true &&
    (dA.body.cancellation.alreadyCancelled === true ||
      dB.body.cancellation.alreadyCancelled === true ||
      dA.body.cancellation.idempotentReplay === true ||
      dB.body.cancellation.idempotentReplay === true ||
      (dA.body.cancellation.status === 'cancelled' &&
        dB.body.cancellation.status === 'cancelled'));
  ctx.disposable.idempotencyKeys.push(kDiffA, kDiffB);

  // ── 4. Cancel / create race (slot reopen) ─────────────────────────
  const key5 = `P7B-C5-${crypto.randomUUID()}`;
  const b5 = await makePublicBooking({
    date: workDate,
    time: '14:00',
    dayOffset: 0,
    empId: empX,
    key: key5,
  });
  const cancelKey5 = `P7B-X5-${crypto.randomUUID()}`;
  await cancelPublicBooking({
    code: b5.code,
    phone,
    clientRequestId: cancelKey5,
    idempotencyKey: cancelKey5,
  });
  ctx.disposable.idempotencyKeys.push(cancelKey5);

  const key5b = `P7B-C5B-${crypto.randomUUID()}`;
  const rebook = await runCreateInSmokeContext(ctx, () =>
    runCreate({
      branchCode: 'GLEEM',
      date: workDate,
      time: '14:00',
      dayOffset: 0,
      serviceIds,
      empId: empX,
      mode: 'specific_barber',
      customerName: `${P6C_MARKER} Phase7B rebook`,
      customerPhone: '01088885555',
      idempotencyKey: key5b,
      suppressNotification: true,
    }),
  );
  proofs.cancel_create_rebook = rebook.ok === true;
  if (rebook.ok) {
    ctx.disposable.bookingCodes.push(rebook.code);
    ctx.disposable.idempotencyKeys.push(key5b);
    // cleanup rebook notes
    await db
      .request()
      .input('code', sql.NVarChar, rebook.code)
      .query(
        `UPDATE dbo.Bookings SET Notes=N'[p6] workDate=${workDate};dayOffset=0', Status=N'cancelled', CancelledAt=SYSUTCDATETIME() WHERE BookingCode=@code`,
      );
  }

  // Active overlap check: at most one non-cancelled at 14:00 for emp
  const overlap = await db
    .request()
    .input('emp', sql.Int, empX)
    .input('wd', sql.Date, workDate)
    .query(`
      SELECT COUNT(*) AS C
      FROM dbo.Bookings
      WHERE AssignedEmpID=@emp
        AND (PublicWorkDate=@wd OR BookingDate=@wd)
        AND CONVERT(VARCHAR(5), StartTime, 108)='14:00'
        AND LOWER(Status) IN ('confirmed','pending','arrived','queued','in_service','in_progress')
    `);
  proofs.no_active_overlap = Number(overlap.recordset[0].C) <= 1;

  // ── 5. Overnight cancel ───────────────────────────────────────────
  const keyOn = `P7B-ON-${crypto.randomUUID()}`;
  const bOn = await makePublicBooking({
    date: workDate,
    time: '00:15',
    dayOffset: 1,
    empId: empX,
    key: keyOn,
  });
  const beforeOn = await db
    .request()
    .input('code', sql.NVarChar, bOn.code)
    .query(`
      SELECT PublicWorkDate, PublicDayOffset, Status
      FROM dbo.Bookings WHERE BookingCode=@code
    `);
  const cancelOnKey = `P7B-XON-${crypto.randomUUID()}`;
  const cancelOn = await cancelPublicBooking({
    code: bOn.code,
    phone,
    clientRequestId: cancelOnKey,
    idempotencyKey: cancelOnKey,
  });
  ctx.disposable.idempotencyKeys.push(cancelOnKey);
  const afterOn = await db
    .request()
    .input('code', sql.NVarChar, bOn.code)
    .query(`
      SELECT PublicWorkDate, PublicDayOffset, Status
      FROM dbo.Bookings WHERE BookingCode=@code
    `);
  const pwdBefore = ymdOf(beforeOn.recordset[0].PublicWorkDate);
  const pwdAfter = ymdOf(afterOn.recordset[0].PublicWorkDate);
  proofs.overnight_workdate_preserved =
    pwdBefore === workDate &&
    pwdAfter === workDate &&
    Number(afterOn.recordset[0].PublicDayOffset) === 1 &&
    String(afterOn.recordset[0].Status).toLowerCase() === 'cancelled' &&
    cancelOn.body.booking.workDate === workDate &&
    cancelOn.body.booking.dayOffset === 1;
  proofs.overnight_debug = {
    pwdBefore,
    pwdAfter,
    dayOffset: afterOn.recordset[0].PublicDayOffset,
    status: afterOn.recordset[0].Status,
    bodyWorkDate: cancelOn.body.booking.workDate,
    bodyDayOffset: cancelOn.body.booking.dayOffset,
  };

  // ── 6. Cutoff closed ──────────────────────────────────────────────
  const keyCut = `P7B-CUT-${crypto.randomUUID()}`;
  const bCut = await makePublicBooking({
    date: workDate,
    time: '19:00',
    dayOffset: 0,
    empId: empX,
    key: keyCut,
  });
  // Force AbsoluteStartUtc into the past window
  await db
    .request()
    .input('code', sql.NVarChar, bCut.code)
    .query(`
      UPDATE dbo.Bookings
      SET AbsoluteStartUtc = DATEADD(MINUTE, 10, SYSUTCDATETIME()),
          AbsoluteEndUtc = DATEADD(MINUTE, 40, SYSUTCDATETIME())
      WHERE BookingCode=@code
    `);
  let cutoffClosed = false;
  try {
    await cancelPublicBooking({
      code: bCut.code,
      phone,
      clientRequestId: `P7B-CUTX-${crypto.randomUUID()}`,
    });
  } catch (e) {
    cutoffClosed =
      e instanceof PublicBookingCancelError &&
      e.code === 'BOOKING_CANCELLATION_WINDOW_CLOSED';
  }
  proofs.cutoff_closed = cutoffClosed;
  // Soft-cancel leftover for cleanup
  await db
    .request()
    .input('code', sql.NVarChar, bCut.code)
    .query(
      `UPDATE dbo.Bookings SET Status=N'cancelled', CancelledAt=SYSUTCDATETIME() WHERE BookingCode=@code`,
    );

  // ── 7. Service-start race (simulated) ─────────────────────────────
  const keySvc = `P7B-SVC-${crypto.randomUUID()}`;
  const bSvc = await makePublicBooking({
    date: workDate,
    time: '13:00',
    dayOffset: 0,
    empId: empX,
    key: keySvc,
  });
  const cancelSvcKey = `P7B-XSVC-${crypto.randomUUID()}`;
  const [svcCancel, svcStart] = await Promise.all([
    cancelPublicBooking({
      code: bSvc.code,
      phone,
      clientRequestId: cancelSvcKey,
      idempotencyKey: cancelSvcKey,
    }).catch((e) => e),
    (async () => {
      // slight delay then force in_service
      await new Promise((r) => setTimeout(r, 5));
      return db
        .request()
        .input('code', sql.NVarChar, bSvc.code)
        .query(`
          UPDATE dbo.Bookings
          SET Status = N'in_service'
          WHERE BookingCode=@code
            AND LOWER(Status) IN (N'confirmed', N'pending')
        `);
    })().catch((e) => e),
  ]);
  void svcStart;
  ctx.disposable.idempotencyKeys.push(cancelSvcKey);
  const stSvc = await db
    .request()
    .input('code', sql.NVarChar, bSvc.code)
    .query(`SELECT Status FROM dbo.Bookings WHERE BookingCode=@code`);
  const finalSvc = String(stSvc.recordset[0].Status).toLowerCase();
  const cancelWon =
    finalSvc === 'cancelled' &&
    !(svcCancel instanceof PublicBookingCancelError);
  const opsWon =
    (finalSvc === 'in_service' || finalSvc === 'cancelled') &&
    (svcCancel instanceof PublicBookingCancelError
      ? svcCancel.code === 'BOOKING_ALREADY_IN_SERVICE' ||
        svcCancel.code === 'BOOKING_NOT_CANCELLABLE' ||
        svcCancel.code === 'BOOKING_LOCK_TIMEOUT'
      : svcCancel.body?.cancellation?.status === 'cancelled');
  // Forbidden: both cancelled and in_service somehow — status is single column
  proofs.service_start_race =
    (cancelWon || opsWon) &&
    !(finalSvc.includes('cancel') && finalSvc.includes('service')) &&
    (finalSvc === 'cancelled' || finalSvc === 'in_service');
  if (finalSvc === 'in_service') {
    await db
      .request()
      .input('code', sql.NVarChar, bSvc.code)
      .query(
        `UPDATE dbo.Bookings SET Status=N'cancelled', CancelledAt=SYSUTCDATETIME() WHERE BookingCode=@code`,
      );
  }

  // ── 8. Smoke hidden + Camp privacy (no public enable) ─────────────
  const campPublic = await db.request().query(`
    SELECT TOP 1
      ISNULL(PublicBookingEnabled, 0) AS PublicBookingEnabled,
      LifecycleStatus
    FROM dbo.TblBranch WHERE BranchCode=N'CAMP_CAESAR'
  `);
  const campRow = campPublic.recordset[0];
  proofs.camp_still_non_public =
    !campRow ||
    Number(campRow.PublicBookingEnabled) === 0 ||
    String(campRow.LifecycleStatus || '') !== 'PUBLIC_LIVE';

  // Hard-delete check
  const stillExists = await db
    .request()
    .input('code', sql.NVarChar, b1.code)
    .query(`SELECT COUNT(*) AS C FROM dbo.Bookings WHERE BookingCode=@code`);
  proofs.no_hard_delete = Number(stillExists.recordset[0].C) === 1;

  const svcSnap = await db
    .request()
    .input('id', sql.Int, bookingId1)
    .query(`SELECT COUNT(*) AS C FROM dbo.BookingServices WHERE BookingID=@id`);
  proofs.service_snapshots_preserved = Number(svcSnap.recordset[0].C) >= 1;

  // Fail gates
  const required = [
    'phone_cancel_ok',
    'slot_blocked_before',
    'slot_unblocked_after',
    'slot_release_removed',
    'lookup_cancelled',
    'upcoming_excludes',
    'same_key_replay',
    'already_cancelled_idempotent',
    'wrong_phone',
    'code_only_rejected',
    'numeric_id_rejected',
    'token_cancel_ok',
    'token_mismatch',
    'concurrent_same_key_status',
    'concurrent_diff_keys',
    'cancel_create_rebook',
    'no_active_overlap',
    'overnight_workdate_preserved',
    'cutoff_closed',
    'service_start_race',
    'camp_still_non_public',
    'no_hard_delete',
    'service_snapshots_preserved',
  ] as const;

  const failed = required.filter((k) => !proofs[k]);
  const passed = failed.length === 0;

  const out = {
    phase: 'booking-phase-7b-cancellation-proof',
    smokeRunId: ctx.smokeRun.smokeRunId,
    passed,
    failed,
    proofs,
  };

  fs.writeFileSync(
    path.join(__dirname, '..', '_booking-phase7b-cancellation-proof.json'),
    JSON.stringify(out, null, 2),
  );

  await completeSmokeRun(ctx, passed ? 'PASSED' : 'FAILED', JSON.stringify(failed));
  await cleanupPhase6C(ctx);

  console.log(JSON.stringify(out, null, 2));
  // Force exit — pool keep-alive
  process.exit(passed ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
