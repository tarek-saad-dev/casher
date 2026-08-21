#!/usr/bin/env npx tsx
/**
 * Booking V2 B8.6 — Stale projection / revision verifier.
 *
 * Compares Source-of-Truth occupancy fingerprints vs availability revision
 * counters for a sample of Emp × BusinessDate. Reports stale candidates.
 * Does NOT auto-repair by default.
 *
 * Usage:
 *   npx tsx scripts/verify-booking-v2-stale-projections.ts
 *   BOOKING_V2_STALE_FIX=1 npx tsx scripts/verify-booking-v2-stale-projections.ts  # bump only
 *
 * Optional env:
 *   BOOKING_V2_STALE_BRANCH_ID
 *   BOOKING_V2_STALE_EMP_ID
 *   BOOKING_V2_STALE_DAYS=14
 */
import path from 'path';
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

function bookingDateYmd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate, shiftCalendarDate } = await import(
    '../src/lib/businessDate'
  );
  const { listBookableEmployeeIdsForBranch } = await import(
    '../src/lib/branch/bookingQueueOwnership'
  );
  const { getAvailabilityRevisionSqlStore } = await import(
    '../src/lib/booking/cache/AvailabilityRevisionSqlStore'
  );
  const { AvailabilityMutationNotifier } = await import(
    '../src/lib/booking/AvailabilityMutationNotifier'
  );

  const db = await getPool();
  const today = getCairoBusinessDate();
  const days = Math.max(1, Number(process.env.BOOKING_V2_STALE_DAYS ?? 14) || 14);
  const to = shiftCalendarDate(today, days - 1);
  const fix = process.env.BOOKING_V2_STALE_FIX === '1';

  let branchId = Number(process.env.BOOKING_V2_STALE_BRANCH_ID ?? 0) || 0;
  if (!branchId) {
    const br = await db.request().query(`
      SELECT TOP 1 BranchID FROM dbo.TblBranch
      WHERE ISNULL(IsActive, 1) = 1
      ORDER BY BranchID
    `);
    branchId = Number(br.recordset[0]?.BranchID ?? 0);
  }
  if (!branchId) {
    console.error('No branch found');
    process.exit(1);
  }

  let empIds: number[] = [];
  const forcedEmp = Number(process.env.BOOKING_V2_STALE_EMP_ID ?? 0) || 0;
  if (forcedEmp) empIds = [forcedEmp];
  else {
    empIds = await listBookableEmployeeIdsForBranch(branchId, today, {
      publicOnly: false,
    });
  }
  empIds = empIds.slice(0, 20);
  if (!empIds.length) {
    console.error('No employees to sample');
    process.exit(1);
  }

  console.log('BOOKING V2 B8.6 STALE PROJECTION VERIFIER');
  console.log(`branch=${branchId} emps=${empIds.length} range=${today}..${to} fix=${fix}`);

  // SoT occupancy counts per Emp×Date
  const empPlaceholders = empIds.map((_, i) => `@e${i}`).join(',');
  const req = db
    .request()
    .input('from', sql.Date, today)
    .input('to', sql.Date, to);
  empIds.forEach((id, i) => req.input(`e${i}`, sql.Int, id));

  const bookings = await req.query(`
    SELECT AssignedEmpID AS EmpID, BookingDate, COUNT(*) AS Cnt
    FROM dbo.Bookings
    WHERE AssignedEmpID IN (${empPlaceholders})
      AND BookingDate BETWEEN @from AND @to
      AND Status IN (N'confirmed', N'arrived', N'queued', N'in_service', N'in_progress', N'pending')
    GROUP BY AssignedEmpID, BookingDate
  `);

  const holdsReq = db
    .request()
    .input('from', sql.Date, today)
    .input('to', sql.Date, to);
  empIds.forEach((id, i) => holdsReq.input(`e${i}`, sql.Int, id));
  let holds: { EmpID: number; BusinessDate: string; Cnt: number }[] = [];
  try {
    const h = await holdsReq.query(`
      SELECT EmpID, CONVERT(varchar(10), BusinessDate, 23) AS BusinessDate, COUNT(*) AS Cnt
      FROM dbo.TblBookingHold
      WHERE EmpID IN (${empPlaceholders})
        AND BusinessDate BETWEEN @from AND @to
        AND Status = N'active'
        AND ExpiresAt > SYSUTCDATETIME()
      GROUP BY EmpID, CONVERT(varchar(10), BusinessDate, 23)
    `);
    holds = h.recordset.map(
      (r: { EmpID: number; BusinessDate: string; Cnt: number }) => ({
        EmpID: Number(r.EmpID),
        BusinessDate: String(r.BusinessDate),
        Cnt: Number(r.Cnt),
      }),
    );
  } catch {
    /* hold table / columns may differ */
  }

  const queueReq = db
    .request()
    .input('from', sql.Date, today)
    .input('to', sql.Date, to);
  empIds.forEach((id, i) => queueReq.input(`e${i}`, sql.Int, id));
  const queue = await queueReq.query(`
    SELECT EmpID, QueueDate, COUNT(*) AS Cnt
    FROM dbo.QueueTickets
    WHERE EmpID IN (${empPlaceholders})
      AND QueueDate BETWEEN @from AND @to
      AND LOWER(Status) IN ('waiting', 'called', 'arrived', 'in_service')
    GROUP BY EmpID, QueueDate
  `);

  type Cell = { bookings: number; holds: number; queue: number };
  const sot = new Map<string, Cell>();
  const cellKey = (emp: number, date: string) => `${emp}:${date}`;
  const ensure = (emp: number, date: string): Cell => {
    const k = cellKey(emp, date);
    let c = sot.get(k);
    if (!c) {
      c = { bookings: 0, holds: 0, queue: 0 };
      sot.set(k, c);
    }
    return c;
  };

  for (const r of bookings.recordset as Array<{
    EmpID: number;
    BookingDate: Date | string;
    Cnt: number;
  }>) {
    ensure(Number(r.EmpID), bookingDateYmd(r.BookingDate)).bookings = Number(r.Cnt);
  }
  for (const r of holds) {
    ensure(r.EmpID, r.BusinessDate).holds = r.Cnt;
  }
  for (const r of queue.recordset as Array<{
    EmpID: number;
    QueueDate: Date | string;
    Cnt: number;
  }>) {
    ensure(Number(r.EmpID), bookingDateYmd(r.QueueDate)).queue = Number(r.Cnt);
  }

  const revStore = getAvailabilityRevisionSqlStore();
  const revBatch = await revStore.loadBatch({
    employeeIds: empIds,
    fromBusinessDate: today,
    toBusinessDate: to,
  });

  const stale: Array<{
    employeeId: number;
    businessDate: string;
    sot: Cell;
    revisionToken: string;
    note: string;
  }> = [];

  for (const [k, cell] of sot) {
    const [empStr, date] = k.split(':');
    const employeeId = Number(empStr);
    const businessDate = String(date);
    const parts = revBatch.byKey.get(k);
    const notes: string[] = [];
    if (cell.bookings > 0 && (!parts || parts.bookingOccupancyRevision <= 0)) {
      notes.push('booking occ without booking revision');
    }
    if (cell.holds > 0 && (!parts || parts.holdOccupancyRevision <= 0)) {
      notes.push('hold occ without hold revision');
    }
    if (cell.queue > 0 && (!parts || parts.queueOccupancyRevision <= 0)) {
      notes.push('queue occ without queue revision');
    }
    if (!notes.length) continue;
    stale.push({
      employeeId,
      businessDate,
      sot: cell,
      revisionToken: parts
        ? `${parts.effectiveWorkRevision}.${parts.bookingOccupancyRevision}.${parts.holdOccupancyRevision}.${parts.queueOccupancyRevision}`
        : 'missing',
      note: notes.join('; '),
    });
  }

  console.log(`\nSoT occupied cells: ${sot.size}`);
  console.log(`Stale candidates: ${stale.length}`);
  for (const s of stale.slice(0, 50)) {
    console.log(
      `  emp=${s.employeeId} date=${s.businessDate} sot=${JSON.stringify(s.sot)} rev=${s.revisionToken} — ${s.note}`,
    );
  }
  if (stale.length > 50) console.log(`  … +${stale.length - 50} more`);

  if (fix && stale.length) {
    console.log('\nApplying revision bumps (BOOKING_V2_STALE_FIX=1)…');
    for (const s of stale) {
      if (s.sot.bookings)
        await AvailabilityMutationNotifier.bookingOccupancyChanged({
          employeeId: s.employeeId,
          businessDate: s.businessDate,
          reason: 'stale_verifier_fix',
        });
      if (s.sot.holds)
        await AvailabilityMutationNotifier.holdOccupancyChanged({
          employeeId: s.employeeId,
          businessDate: s.businessDate,
          reason: 'stale_verifier_fix',
        });
      if (s.sot.queue)
        await AvailabilityMutationNotifier.queueOccupancyChanged({
          employeeId: s.employeeId,
          businessDate: s.businessDate,
          reason: 'stale_verifier_fix',
        });
    }
    console.log(`Fixed ${stale.length} cells (revision bump only).`);
  } else if (stale.length) {
    console.log('\nNo auto-fix (set BOOKING_V2_STALE_FIX=1 to bump revisions).');
  }

  console.log(
    stale.length
      ? '\nBOOKING V2 STALE PROJECTIONS FOUND'
      : '\nBOOKING V2 STALE PROJECTION CHECK CLEAN',
  );
  process.exit(stale.length && !fix ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
