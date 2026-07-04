/**
 * Read-only audit for overlapping booking/queue intervals.
 * Run: npx tsx scripts/audit-schedule-conflicts.ts [YYYY-MM-DD]
 */
import { getPool } from '../src/lib/db';
import { getDefaultDuration, buildQueueIntervals, buildBookingIntervals } from '../src/lib/queueEstimateEngine';
import { getCairoBusinessDate } from '../src/lib/businessDate';
import { findOverlappingIntervals } from '../src/lib/scheduleIntervals';

async function main() {
  const dateStr = process.argv[2] || getCairoBusinessDate();
  const db = await getPool();
  const defaultDur = await getDefaultDuration(db);
  const now = new Date();

  const barbers = await db.request().query(`
    SELECT EmpID, EmpName FROM [dbo].[TblEmp]
    WHERE isActive = 1 AND Job = N'حلاق'
    ORDER BY EmpName
  `);

  console.log(`Schedule conflict audit for ${dateStr}\n`);

  for (const barber of barbers.recordset) {
    const empId = barber.EmpID as number;
    const qIvs = await buildQueueIntervals(db, empId, dateStr, now, defaultDur, undefined, {
      filterStale: true,
      graceMinutes: 30,
      debugContext: 'audit',
    });
    const bIvs = await buildBookingIntervals(db, empId, dateStr, defaultDur);
    const busy = [...qIvs, ...bIvs].map((iv) => ({
      id: iv.id,
      source: iv.source,
      start: iv.start,
      end: iv.end,
      ticketCode: iv.ticketCode,
    }));

    for (let i = 0; i < busy.length; i++) {
      for (let j = i + 1; j < busy.length; j++) {
        const a = busy[i];
        const b = busy[j];
        const overlaps = findOverlappingIntervals(a.start, a.end, [b]);
        if (overlaps.length > 0) {
          const overlapMs =
            Math.min(a.end.getTime(), b.end.getTime()) -
            Math.max(a.start.getTime(), b.start.getTime());
          console.log(`CONFLICT barber=${barber.EmpName} (${empId})`);
          console.log(`  A: ${a.source}#${a.id} ${a.start.toISOString()} → ${a.end.toISOString()}`);
          console.log(`  B: ${b.source}#${b.id} ${b.start.toISOString()} → ${b.end.toISOString()}`);
          console.log(`  overlapMinutes=${Math.round(overlapMs / 60000)}\n`);
        }
      }
    }
  }

  console.log('Audit complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
