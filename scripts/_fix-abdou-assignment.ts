import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const m = Module as any;
const orig = m._load;
m._load = function (r: string, ...a: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...a);
};

const EMP_ID = 1192;

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const db = await getPool();

  const assign = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT ID, BranchID, EffectiveFrom, EffectiveTo, CanReceiveBookings
    FROM dbo.TblEmpBranchAssignment WHERE EmpID = @empId ORDER BY EffectiveFrom DESC
  `);
  console.log('BEFORE assign:', assign.recordset);

  const counts = await db.request().query(`
    SELECT 'CC_ATT' kind, COUNT(*) cnt FROM dbo.TblEmpAttendance WHERE EmpID=1192 AND BranchID=3 AND WorkDate>='2026-08-15'
    UNION ALL SELECT 'GLEEM_ATT', COUNT(*) FROM dbo.TblEmpAttendance WHERE EmpID=1192 AND BranchID=1 AND WorkDate>='2026-08-15'
    UNION ALL SELECT 'CC_PAY', COUNT(*) FROM dbo.TblEmpDailyPayroll WHERE EmpID=1192 AND BranchID=3 AND WorkDate>='2026-08-15'
    UNION ALL SELECT 'GLEEM_PAY', COUNT(*) FROM dbo.TblEmpDailyPayroll WHERE EmpID=1192 AND BranchID=1 AND WorkDate>='2026-08-15'
  `);
  console.log('COUNTS:', counts.recordset);

  // Change CC assignment row to Gleem (started Aug 15 — never actually worked at CC after move)
  const ccRow = assign.recordset.find((r: { BranchID: number }) => Number(r.BranchID) === 3);
  if (ccRow) {
    await db
      .request()
      .input('id', sql.BigInt, ccRow.ID)
      .input('toBranch', sql.Int, 1)
      .query(`
        UPDATE dbo.TblEmpBranchAssignment
        SET BranchID = @toBranch, UpdatedAt = SYSDATETIME()
        WHERE ID = @id
      `);
    console.log(`Updated assignment ${ccRow.ID}: branch 3 → 1`);
  }

  const after = await db.request().input('empId', sql.Int, EMP_ID).query(`
    SELECT ID, BranchID, EffectiveFrom, EffectiveTo FROM dbo.TblEmpBranchAssignment WHERE EmpID = @empId
  `);
  console.log('AFTER assign:', after.recordset);

  const gleem = await db.request().query(`
    SELECT CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
      p.DailyWage, p.ActualHours
    FROM dbo.TblEmpAttendance a
    LEFT JOIN dbo.TblEmpDailyPayroll p ON p.EmpID=a.EmpID AND p.BranchID=a.BranchID AND p.WorkDate=a.WorkDate
    WHERE a.EmpID=1192 AND a.BranchID=1 AND a.WorkDate BETWEEN '2026-08-15' AND '2026-08-27'
    ORDER BY a.WorkDate
  `);
  console.table(gleem.recordset);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
