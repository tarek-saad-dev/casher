#!/usr/bin/env npx tsx
/** Phase 10A — deactivate duplicate active schedule versions for Ahmed@Camp (keep newest per DOW). */
import Module from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';
for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* */
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};
async function main() {
  const { getPool } = await import('../src/lib/db');
  const db = await getPool();
  const result = await db.request().query(`
    ;WITH ranked AS (
      SELECT ScheduleID,
        ROW_NUMBER() OVER (PARTITION BY EmpID, BranchID, DayOfWeek ORDER BY ScheduleID DESC) AS rn
      FROM dbo.TblEmpBranchWorkSchedule
      WHERE EmpID=18 AND BranchID=3 AND IsActive=1
    )
    UPDATE s
    SET IsActive=0, UpdatedAt=SYSUTCDATETIME(),
        Notes = LEFT(CONCAT(ISNULL(Notes,N''), N' | Phase10A dedupe'), 250)
    FROM dbo.TblEmpBranchWorkSchedule s
    INNER JOIN ranked r ON r.ScheduleID = s.ScheduleID
    WHERE r.rn > 1;

    SELECT DayOfWeek, COUNT(*) AS ActiveRows
    FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID=18 AND BranchID=3 AND IsActive=1
    GROUP BY DayOfWeek
    ORDER BY DayOfWeek;
  `);
  console.log(JSON.stringify(result.recordsets?.[1] || result.recordset, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
