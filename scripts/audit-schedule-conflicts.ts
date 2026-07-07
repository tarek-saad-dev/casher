/**
 * Read-only audit: scan active bookings + queue allocations per barber/day
 * and report half-open [start, end) overlaps.
 *
 * Usage: npx tsx scripts/audit-schedule-conflicts.ts [YYYY-MM-DD]
 */

import { getPool } from '../src/lib/db';
import { getEmployeeBusyIntervals } from '../src/lib/scheduleIntegrity';
import { intervalsOverlap } from '../src/lib/scheduleIntervals';
import { getCairoBusinessDate } from '../src/lib/businessDate';

interface OverlapReport {
  empId: number;
  operationalDate: string;
  a: { type: string; id: number; start: string; end: string; label?: string };
  b: { type: string; id: number; start: string; end: string; label?: string };
  overlapMinutes: number;
}

async function main() {
  const targetDate = process.argv[2] ?? getCairoBusinessDate();
  const db = await getPool();
  const now = new Date();

  const barbersRes = await db.request().query(`
    SELECT EmpID FROM dbo.TblEmp
    WHERE ISNULL(isActive, 1) = 1
      AND Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
  `);

  const reports: OverlapReport[] = [];

  for (const row of barbersRes.recordset as { EmpID: number }[]) {
    const empId = row.EmpID;
    const busy = await getEmployeeBusyIntervals({
      empId,
      operationalDate: targetDate,
      now,
    });

    for (let i = 0; i < busy.length; i++) {
      for (let j = i + 1; j < busy.length; j++) {
        const a = busy[i];
        const b = busy[j];
        if (!intervalsOverlap(a.start, a.end, b.start, b.end)) continue;

        const overlapStart = Math.max(a.start.getTime(), b.start.getTime());
        const overlapEnd = Math.min(a.end.getTime(), b.end.getTime());
        const overlapMinutes = Math.round((overlapEnd - overlapStart) / 60000);

        reports.push({
          empId,
          operationalDate: targetDate,
          a: {
            type: a.source,
            id: a.id,
            start: a.start.toISOString(),
            end: a.end.toISOString(),
            label: a.label ?? a.ticketCode,
          },
          b: {
            type: b.source,
            id: b.id,
            start: b.start.toISOString(),
            end: b.end.toISOString(),
            label: b.label ?? b.ticketCode,
          },
          overlapMinutes,
        });
      }
    }
  }

  if (reports.length === 0) {
    console.log(`No schedule overlaps found for ${targetDate}.`);
    process.exit(0);
  }

  console.log(`Found ${reports.length} overlap(s) on ${targetDate}:\n`);
  for (const r of reports) {
    console.log(
      `EmpID ${r.empId} | ${r.overlapMinutes}min overlap\n` +
      `  A: ${r.a.type} #${r.a.id} ${r.a.start} → ${r.a.end}${r.a.label ? ` (${r.a.label})` : ''}\n` +
      `  B: ${r.b.type} #${r.b.id} ${r.b.start} → ${r.b.end}${r.b.label ? ` (${r.b.label})` : ''}\n`,
    );
  }

  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
