#!/usr/bin/env npx tsx
/**
 * Emergency cleanup: remove AUTO_ABSENCE rows created by live verification
 * on business date, for GLEEM branch, when Notes contain AUTO_ABSENCE.
 * Does NOT touch Present/Late attendance.
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

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const db = await getPool();
  const businessDate = getCairoBusinessDate();

  const before = await db
    .request()
    .input('date', sql.Date, businessDate)
    .query(`
      SELECT EmpID, BranchID, Status, LEFT(Notes,80) AS Notes
      FROM dbo.TblEmpAttendance
      WHERE WorkDate=@date AND Status=N'Absent' AND Notes LIKE N'%AUTO_ABSENCE%'
    `);
  console.log('before', before.recordset.length);

  await db
    .request()
    .input('date', sql.Date, businessDate)
    .query(`
      DELETE FROM dbo.TblEmpAttendance
      WHERE WorkDate=@date AND Status=N'Absent' AND Notes LIKE N'%AUTO_ABSENCE%';

      UPDATE dbo.TblEmpScheduleOverrides
      SET IsActive = 0
      WHERE OverrideDate=@date AND Reason LIKE N'%AUTO_ABSENCE%';
    `);

  const after = await db
    .request()
    .input('date', sql.Date, businessDate)
    .query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.TblEmpAttendance
      WHERE WorkDate=@date AND Status=N'Absent' AND Notes LIKE N'%AUTO_ABSENCE%'
    `);
  console.log('after', after.recordset[0]?.Cnt);
  console.log('CLEANUP_OK', { businessDate, removed: before.recordset.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
