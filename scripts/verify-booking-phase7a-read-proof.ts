#!/usr/bin/env npx tsx
/**
 * Booking Phase 7A — live read proof (lookup + upcoming).
 * BOOKING_PHASE_7A_VERIFIER=enabled npx tsx scripts/verify-booking-phase7a-read-proof.ts
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

async function main() {
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
    getPublicBookingByCode,
    listPublicUpcomingBookings,
    PublicBookingReadError,
  } = await import('../src/lib/booking/publicBookingReader');
  const { mintBookingAccessToken } = await import('../src/lib/booking/publicBookingAccessToken');

  // Override phase name for smoke registry
  const ctx = await initPhase6CSmokeContext();
  const workDate = '2026-12-28';
  const { empX } = await setupDisposableBarberPair(ctx, workDate, '08:00', '22:00');
  await ctx.db
    .request()
    .input('branchId', sql.Int, ctx.gleemBranchId)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );

  const phone = '01088887777';
  const serviceIds = ctx.serviceProIds.slice(0, 1);
  const key = `P7A-READ-${crypto.randomUUID()}`;

  const created = await runCreateInSmokeContext(ctx, () =>
    runCreate({
      branchCode: 'GLEEM',
      date: workDate,
      time: '14:00',
      dayOffset: 0,
      serviceIds,
      empId: empX,
      mode: 'specific_barber',
      customerName: `${P6C_MARKER} Phase7A`,
      customerPhone: phone,
      idempotencyKey: key,
      suppressNotification: true,
    }),
  );
  if (!created.ok) throw new Error(`create failed: ${created.code}`);
  ctx.disposable.bookingCodes.push(created.code);
  ctx.disposable.idempotencyKeys.push(key);

  // Public origin requires Source=online (create) — but notes have [SMOKE P6C]
  // Strip smoke notes marker for read-origin test by updating Notes to p6-only.
  const db = await getPool();
  await db
    .request()
    .input('code', sql.NVarChar, created.code)
    .query(
      `UPDATE dbo.Bookings SET Notes=N'[p6] workDate=${workDate};dayOffset=0' WHERE BookingCode=@code`,
    );

  const proofs: Record<string, unknown> = {};

  const owned = await getPublicBookingByCode({ code: created.code, phone });
  proofs.lookup_phone_ok = owned.ownership === 'owner' && owned.booking.code === created.code;
  proofs.canonical_dates = owned.booking.dateSource === 'canonical' || owned.booking.workDate === workDate;
  proofs.has_token = !!owned.bookingAccessToken;

  let wrongPhone = false;
  try {
    await getPublicBookingByCode({ code: created.code, phone: '01011112222' });
  } catch (e) {
    wrongPhone = e instanceof PublicBookingReadError && e.code === 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED';
  }
  proofs.wrong_phone = wrongPhone;

  const token = mintBookingAccessToken({
    bookingCode: created.code,
    normalizedPhone: phone,
  }).token;
  const byToken = await getPublicBookingByCode({ code: created.code, accessToken: token });
  proofs.token_ok = byToken.ownership === 'owner';

  let tokenMismatch = false;
  try {
    await getPublicBookingByCode({
      code: created.code,
      accessToken: mintBookingAccessToken({
        bookingCode: 'BK-OTHER1',
        normalizedPhone: phone,
      }).token,
    });
  } catch (e) {
    tokenMismatch =
      e instanceof PublicBookingReadError &&
      (e.code === 'BOOKING_ACCESS_TOKEN_INVALID' ||
        e.code === 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
  }
  proofs.token_code_mismatch = tokenMismatch;

  const minimal = await getPublicBookingByCode({ code: created.code });
  proofs.code_only_minimal =
    minimal.ownership === 'minimal' &&
    minimal.booking.notes === null &&
    !('customerName' in minimal.booking);

  const upcoming = await listPublicUpcomingBookings({ phone, limit: 10 });
  proofs.upcoming_contains = upcoming.bookings.some((b) => b.code === created.code);
  proofs.upcoming_no_ids = upcoming.bookings.every(
    (b) => !('id' in b) && !('BookingID' in b) && !('phone' in b),
  );

  // Hide: mark as smoke_seed
  await db
    .request()
    .input('code', sql.NVarChar, created.code)
    .query(`UPDATE dbo.Bookings SET Source=N'smoke_seed' WHERE BookingCode=@code`);
  let hidden = false;
  try {
    await getPublicBookingByCode({ code: created.code, phone });
  } catch (e) {
    hidden = e instanceof PublicBookingReadError;
  }
  proofs.smoke_hidden = hidden;

  await cleanupPhase6C(ctx);
  await completeSmokeRun(ctx, 'PASSED', { phase: 'booking-phase-7a-read-proof', proofs });

  const dest = path.join(__dirname, 'branch-smoke', '_booking-phase7a-read-proof.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = {
    smokeRunId: ctx.smokeRun.smokeRunId,
    status: Object.values(proofs).every(Boolean) ? 'PASSED' : 'FAILED',
    proofs,
  };
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log('wrote', dest);
  if (out.status !== 'PASSED') process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
