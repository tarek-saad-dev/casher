import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

async function main() {
  const { getPool } = await import('../../src/lib/db');
  const pool = await getPool();
  await pool.request().query(`
    UPDATE e SET e.isActive = 0
    FROM dbo.TblEmp e
    WHERE e.EmpName LIKE N'%[[]TEST]%' OR e.EmpName LIKE N'%[[]SMOKE%';

    UPDATE a SET a.IsActive = 0
    FROM dbo.TblEmpBranchAssignment a
    INNER JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    WHERE e.EmpName LIKE N'%[[]TEST]%' OR e.EmpName LIKE N'%[[]SMOKE%';

    UPDATE s SET s.IsActive = 0
    FROM dbo.TblEmpBranchWorkSchedule s
    INNER JOIN dbo.TblEmp e ON e.EmpID = s.EmpID
    WHERE e.EmpName LIKE N'%[[]TEST]%' OR e.EmpName LIKE N'%[[]SMOKE%';

    UPDATE p SET p.IsActive = 0
    FROM dbo.TblEmpBranchPayrollPlan p
    INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    WHERE e.EmpName LIKE N'%[[]TEST]%' OR e.EmpName LIKE N'%[[]SMOKE%';
  `);
  const r = await pool.request().query(`
    SELECT EmpID, EmpName, isActive FROM dbo.TblEmp
    WHERE EmpName LIKE N'%[[]TEST]%' OR EmpName LIKE N'%[[]SMOKE 1U]%'
    ORDER BY EmpID DESC
  `);
  console.log(r.recordset);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
