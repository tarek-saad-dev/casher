/**
 * Read-only audit: compare stored booking interval vs service-derived duration.
 *
 * Usage: npx tsx scripts/audit-booking-duration-mismatches.ts [YYYY-MM-DD]
 */

import { getPool } from '../src/lib/db';
import { getCairoBusinessDate } from '../src/lib/businessDate';

interface MismatchRow {
  bookingId: number;
  empId: number | null;
  startAt: string;
  endAt: string;
  storedDurationMinutes: number;
  serviceDerivedMinutes: number;
  differenceMinutes: number;
  serviceCount: number;
}

async function main() {
  const targetDate = process.argv[2] ?? getCairoBusinessDate();
  const db = await getPool();

  const res = await db.request()
    .input('d', targetDate)
    .query(`
      SELECT
        b.BookingID,
        b.AssignedEmpID AS EmpID,
        b.StartTime,
        b.EndTime,
        DATEDIFF(MINUTE, b.StartTime, b.EndTime) AS StoredDurationMinutes,
        ISNULL(svc.ServiceDerivedMinutes, 0) AS ServiceDerivedMinutes,
        ISNULL(svc.ServiceCount, 0) AS ServiceCount
      FROM dbo.Bookings b
      OUTER APPLY (
        SELECT
          SUM(ISNULL(bs.DurationMinutes, 30)) AS ServiceDerivedMinutes,
          COUNT(*) AS ServiceCount
        FROM dbo.BookingServices bs
        WHERE bs.BookingID = b.BookingID
      ) svc
      WHERE CAST(b.BookingDate AS DATE) = @d
        AND b.Status NOT IN ('cancelled', 'no_show')
        AND b.StartTime IS NOT NULL
        AND b.EndTime IS NOT NULL
      ORDER BY b.BookingID
    `);

  const mismatches: MismatchRow[] = [];

  for (const row of res.recordset) {
    const stored = Number(row.StoredDurationMinutes) || 0;
    const derived = Number(row.ServiceDerivedMinutes) || 0;
    const diff = Math.abs(stored - derived);
    if (diff <= 1) continue;

    mismatches.push({
      bookingId: row.BookingID,
      empId: row.EmpID ?? null,
      startAt: row.StartTime?.toISOString?.() ?? String(row.StartTime),
      endAt: row.EndTime?.toISOString?.() ?? String(row.EndTime),
      storedDurationMinutes: stored,
      serviceDerivedMinutes: derived,
      differenceMinutes: diff,
      serviceCount: Number(row.ServiceCount) || 0,
    });
  }

  console.log(`\n=== Booking duration mismatches — ${targetDate} ===`);
  console.log(`Scanned: ${res.recordset.length} bookings`);
  console.log(`Mismatches (>1 min): ${mismatches.length}\n`);

  if (!mismatches.length) {
    console.log('No mismatches found.');
    return;
  }

  for (const m of mismatches) {
    console.log(
      `[Booking ${m.bookingId}] stored=${m.storedDurationMinutes}min services=${m.serviceDerivedMinutes}min diff=${m.differenceMinutes}min emp=${m.empId ?? '-'} services=${m.serviceCount}`,
    );
    console.log(`  ${m.startAt} → ${m.endAt}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
