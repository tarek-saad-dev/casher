#!/usr/bin/env npx tsx
/**
 * Booking Phase 7C2 — live backend readiness smoke (compat mode, no real WhatsApp).
 * BOOKING_PHASE_7C2_SMOKE=enabled npx tsx scripts/verify-booking-phase7c2-backend-readiness-smoke.ts
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { performance } from 'perf_hooks';
import { NextRequest } from 'next/server';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  if (process.env.BOOKING_PHASE_7C2_SMOKE !== 'enabled') {
    console.log('Set BOOKING_PHASE_7C2_SMOKE=enabled to run.');
    process.exit(2);
  }

  process.env.PUBLIC_BOOKING_CONTRACT_MODE = 'compat';
  process.env.PUBLIC_BOOKING_ALLOWED_ORIGINS =
    process.env.PUBLIC_BOOKING_ALLOWED_ORIGINS || 'https://cutsaloon.com';

  const {
    initPhase6CSmokeContext,
    setupDisposableBarberPair,
    cleanupPhase6C,
    completeSmokeRun,
    P6C_MARKER,
  } = await import('../src/lib/__tests__/helpers/phase6cSmokeHarness');
  const { getPool, sql } = await import('../src/lib/db');
  const { getPublicAvailableDays } = await import(
    '../src/lib/booking/publicBookingAvailability'
  );
  const { evaluatePublicBookingSelection } = await import(
    '../src/lib/booking/publicBookingSelectionEvaluator'
  );
  const { createPublicBooking, PublicBookingCreateError } = await import(
    '../src/lib/booking/publicBookingCreate'
  );
  const {
    getPublicBookingByCode,
    listPublicUpcomingBookings,
  } = await import('../src/lib/booking/publicBookingReader');
  const { cancelPublicBooking } = await import(
    '../src/lib/booking/publicBookingCancellation'
  );
  const { mintBookingAccessToken } = await import(
    '../src/lib/booking/publicBookingAccessToken'
  );
  const { resolvePublicBookingBranchContext } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const {
    resetPublicBookingRateLimitsForTests,
    checkPublicBookingRateLimit,
  } = await import('../src/lib/booking/publicBookingRateLimitPolicy');
  const {
    PUBLIC_BOOKING_API_CONTRACT_VERSION,
    isPublicBookingEnforceMode,
  } = await import('../src/lib/booking/publicBookingContractMode');
  const { GET: branchesGet } = await import('../src/app/api/public/branches/route');
  const { gatePublicBookingRoute } = await import(
    '../src/lib/booking/publicBookingRouteGate'
  );

  const db = await getPool();
  const ctx = await initPhase6CSmokeContext();
  const smokeRunId = ctx.smokeRun.smokeRunId;
  const proofs: Record<string, unknown> = {
    smokeRunId,
    phase: 'booking-phase-7c2-backend-readiness',
  };
  const timings: Record<string, number> = {};
  const workDate = '2026-12-30';
  const { empX } = await setupDisposableBarberPair(ctx, workDate, '09:00', '18:00');
  const serviceIds = ctx.serviceProIds.slice(0, 1);
  const phone = '01077776666';

  const gleemCode = String(
    (
      await db.request().input('id', sql.Int, ctx.gleemBranchId).query(`
        SELECT BranchCode FROM dbo.TblBranch WHERE BranchID=@id
      `)
    ).recordset[0]?.BranchCode ?? 'GLEEM',
  );

  await db
    .request()
    .input('branchId', sql.Int, ctx.gleemBranchId)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );

  const t0 = performance.now();
  const branchesRes = await branchesGet(
    new NextRequest('http://localhost/api/public/branches', {
      headers: { 'x-forwarded-for': '203.0.113.50' },
    }),
  );
  timings.branches_ms = Math.round(performance.now() - t0);
  proofs.branches_ok = branchesRes.status === 200;
  proofs.branches_contract_version =
    branchesRes.headers.get('X-Booking-Contract-Version') === PUBLIC_BOOKING_API_CONTRACT_VERSION;

  const toDate = '2027-01-12';
  const tDays = performance.now();
  const days = await getPublicAvailableDays({
    branchCode: gleemCode,
    serviceIds,
    from: workDate,
    to: toDate,
  });
  timings.available_days_cold_ms = Math.round(performance.now() - tDays);
  proofs.available_days_ok = days.ok && days.days.length > 0;

  const { listAvailableBookingSlots } = await import('../src/lib/bookingAvailabilityEngine');
  const slotProbe = await listAvailableBookingSlots({
    date: workDate,
    serviceIds,
    mode: 'nearest',
    branchId: ctx.gleemBranchId,
    source: 'public',
    collectAllCandidates: true,
  });
  const firstSlot = slotProbe.availableSlots.find((s) => s.available);
  assert(firstSlot, `no available slot on ${workDate}: ${slotProbe.unavailableReason ?? 'unknown'}`);
  const slotTime = firstSlot.time;
  const slotDayOffset = (firstSlot.dayOffset ?? 0) as 0 | 1;

  const tCheck = performance.now();
  const check = await evaluatePublicBookingSelection({
    branchCode: 'GLEEM',
    date: workDate,
    time: slotTime,
    dayOffset: slotDayOffset,
    serviceIds,
    mode: 'any_barber',
    purpose: 'check_slot',
  });
  timings.check_slot_ms = Math.round(performance.now() - tCheck);
  proofs.check_slot_ok = check.available === true || check.available === false;

  const tPlan = performance.now();
  const planEval = await evaluatePublicBookingSelection({
    branchCode: 'GLEEM',
    date: workDate,
    time: slotTime,
    dayOffset: slotDayOffset,
    serviceIds,
    mode: 'any_barber',
    purpose: 'plan',
  });
  timings.plan_ms = Math.round(performance.now() - tPlan);
  proofs.plan_ok = planEval.available === true && !!planEval.planToken;
  assert(planEval.planToken, `plan token missing: ${planEval.availabilityCode ?? 'unknown'}`);

  const idemKey = `p7c2-smoke-${smokeRunId}-${crypto.randomUUID().slice(0, 8)}`;
  ctx.disposable.idempotencyKeys.push(idemKey);

  const tCreate = performance.now();
  const created = await createPublicBooking({
    branchCode: 'GLEEM',
    date: workDate,
    time: slotTime,
    dayOffset: slotDayOffset,
    serviceIds,
    mode: 'any_barber',
    planToken: planEval.planToken!,
    customer: { name: `${P6C_MARKER} 7C2`, phone },
    clientRequestId: idemKey,
    suppressNotification: true,
  });
  timings.create_ms = Math.round(performance.now() - tCreate);
  const bookingCode = String(created.body.booking.code);
  ctx.disposable.bookingCodes.push(bookingCode);
  proofs.create_ok = created.httpStatus === 201;

  await db
    .request()
    .input('code', sql.NVarChar, bookingCode)
    .input('notes', sql.NVarChar, `[p7c2] workDate=${workDate};dayOffset=${slotDayOffset}`)
    .query(`UPDATE dbo.Bookings SET Notes=@notes, Source=N'online' WHERE BookingCode=@code`);

  const replay = await createPublicBooking({
    branchCode: 'GLEEM',
    date: workDate,
    time: slotTime,
    dayOffset: slotDayOffset,
    serviceIds,
    mode: 'any_barber',
    planToken: planEval.planToken!,
    customer: { name: `${P6C_MARKER} 7C2`, phone },
    clientRequestId: idemKey,
    suppressNotification: true,
  });
  proofs.idempotent_replay =
    replay.body.meta.idempotentReplay === true && replay.body.booking.code === bookingCode;

  const { token: accessToken } = mintBookingAccessToken({
    bookingCode,
    normalizedPhone: phone,
  });

  const lookup = await getPublicBookingByCode({ code: bookingCode, phone, accessToken });
  proofs.lookup_ok = lookup.booking.code === bookingCode;

  const upcoming = await listPublicUpcomingBookings({ phone, limit: 5 });
  proofs.upcoming_includes = upcoming.bookings.some((b) => b.code === bookingCode);

  const cancelKey = `p7c2-cancel-${smokeRunId}`;
  ctx.disposable.idempotencyKeys.push(cancelKey);
  const cancelled = await cancelPublicBooking({
    code: bookingCode,
    phone,
    accessToken,
    idempotencyKey: cancelKey,
    suppressNotification: true,
  });
  proofs.cancel_ok = cancelled.body.ok === true && cancelled.body.booking.status === 'cancelled';

  const lookupAfter = await getPublicBookingByCode({ code: bookingCode, phone, accessToken });
  proofs.lookup_cancelled = lookupAfter.booking.status === 'cancelled';

  const upcomingAfter = await listPublicUpcomingBookings({ phone, limit: 5 });
  proofs.upcoming_excludes = !upcomingAfter.bookings.some((b) => b.code === bookingCode);

  const { OPTIONS: createOptions } = await import(
    '../src/app/api/public/booking/create/route'
  );
  const corsRes = await createOptions(
    new NextRequest('http://localhost/api/public/booking/create', {
      method: 'OPTIONS',
      headers: { Origin: 'https://cutsaloon.com' },
    }),
  );
  proofs.cors_allowed =
    corsRes.status === 204 &&
    corsRes.headers.get('Access-Control-Allow-Origin') === 'https://cutsaloon.com';

  resetPublicBookingRateLimitsForTests();
  const ip = '203.0.113.99';
  for (let i = 0; i < 11; i++) {
    checkPublicBookingRateLimit({ family: 'cancel', clientIp: ip, subjectDigest: 'abc123digest' });
  }
  const { blocked: rlBlocked } = gatePublicBookingRoute(
    new NextRequest('http://localhost/api/public/booking/cancel', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip, Origin: 'https://cutsaloon.com' },
    }),
    'cancel',
    'abc123digest',
  );
  const rlBody = rlBlocked ? await rlBlocked.json() : null;
  proofs.rate_limit_429 =
    rlBlocked?.status === 429 &&
    rlBody?.error?.code === 'RATE_LIMIT_EXCEEDED' &&
    rlBlocked.headers.has('Retry-After');

  try {
    await resolvePublicBookingBranchContext({
      branchCode: 'CAMP_CAESAR',
      purpose: 'public_booking',
    });
    proofs.camp_caesar_hidden = false;
  } catch (err) {
    proofs.camp_caesar_hidden =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'BRANCH_NOT_PUBLIC';
  }

  const prevMode = process.env.PUBLIC_BOOKING_CONTRACT_MODE;
  process.env.PUBLIC_BOOKING_CONTRACT_MODE = 'enforce';
  proofs.enforce_mode_active = isPublicBookingEnforceMode();
  try {
    await createPublicBooking({
      branchCode: 'GLEEM',
      date: workDate,
      time: '11:00',
      dayOffset: 0,
      serviceIds,
      mode: 'any_barber',
      customer: { name: `${P6C_MARKER} enforce`, phone },
      suppressNotification: true,
    });
    proofs.enforce_blocks_missing_plan = false;
  } catch (err) {
    proofs.enforce_blocks_missing_plan =
      err instanceof PublicBookingCreateError && err.code === 'PLAN_TOKEN_REQUIRED';
  }
  process.env.PUBLIC_BOOKING_CONTRACT_MODE = prevMode ?? 'compat';

  await cleanupPhase6C(ctx);
  proofs.cleanup_ok = true;

  await completeSmokeRun(ctx, 'PASSED', { proofs, timings });

  const required = [
    'branches_ok',
    'branches_contract_version',
    'available_days_ok',
    'create_ok',
    'idempotent_replay',
    'lookup_ok',
    'cancel_ok',
    'lookup_cancelled',
    'upcoming_excludes',
    'cors_allowed',
    'rate_limit_429',
    'camp_caesar_hidden',
    'enforce_blocks_missing_plan',
    'cleanup_ok',
  ] as const;
  const failed = required.filter((k) => !proofs[k]);
  const passed = failed.length === 0;

  const out = {
    phase: 'booking-phase-7c2-backend-readiness',
    smokeRunId,
    passed,
    failed,
    timings,
    proofs,
  };
  fs.writeFileSync(
    path.join(__dirname, '..', '_booking-phase7c2-backend-readiness-smoke.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
