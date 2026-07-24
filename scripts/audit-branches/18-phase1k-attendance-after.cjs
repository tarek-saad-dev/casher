/**
 * Phase 1K — attendance after fingerprint (read-only).
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { pool, database } = await connectReadOnly();
  if (database !== 'last132') throw new Error(`Expected last132, got ${database}`);

  const q = async (sqlText) => (await pool.request().query(sqlText)).recordset;

  const gleem = (await q(`SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'`))[0];
  const ph1 = (await q(`SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'PH1GTEST'`))[0];

  const stats = await q(`
    SELECT
      COUNT(*) AS rows,
      COUNT(DISTINCT EmpID) AS employees,
      MIN(WorkDate) AS minWorkDate,
      MAX(WorkDate) AS maxWorkDate,
      SUM(CASE WHEN BranchID IS NULL THEN 1 ELSE 0 END) AS nullBranchId,
      SUM(CASE WHEN BranchID = ${gleem.BranchID} THEN 1 ELSE 0 END) AS gleemRows,
      SUM(CASE WHEN BranchID = ${ph1 ? ph1.BranchID : -1} THEN 1 ELSE 0 END) AS ph1gtestRows,
      SUM(CASE WHEN CheckOutTime IS NULL AND CheckInTime IS NOT NULL THEN 1 ELSE 0 END) AS openSessions,
      SUM(CASE WHEN CheckInTime IS NULL THEN 1 ELSE 0 END) AS nullCheckIn
    FROM dbo.TblEmpAttendance
  `);

  const multiOpen = await q(`
    SELECT EmpID, COUNT(*) AS c
    FROM dbo.TblEmpAttendance
    WHERE CheckInTime IS NOT NULL AND CheckOutTime IS NULL
    GROUP BY EmpID
    HAVING COUNT(*) > 1
  `);

  const dupBranchEmpDate = await q(`
    SELECT BranchID, EmpID, WorkDate, COUNT(*) AS c
    FROM dbo.TblEmpAttendance
    GROUP BY BranchID, EmpID, WorkDate
    HAVING COUNT(*) > 1
  `);

  const indexes = await q(`
    SELECT i.name, i.is_unique,
           STRING_AGG(c.name, N',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS cols
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID(N'dbo.TblEmpAttendance') AND i.name IS NOT NULL
    GROUP BY i.name, i.is_unique
    ORDER BY i.name
  `);

  const viewExists = await q(`
    SELECT OBJECT_ID(N'dbo.vw_EmpAttendancePayrollDay', N'V') AS id
  `);

  const branchCol = await q(`
    SELECT is_nullable FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblEmpAttendance') AND name = N'BranchID'
  `);

  const active = await q(`SELECT BranchCode FROM dbo.TblBranch WHERE IsActive = 1`);
  const payrollCount = await q(`SELECT COUNT(*) AS c FROM dbo.TblEmpDailyPayroll`);

  const beforePath = path.join(__dirname, '_phase1k-attendance-before.json');
  let before = null;
  if (fs.existsSync(beforePath)) {
    before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  }

  const out = {
    capturedAt: new Date().toISOString(),
    database,
    gleemBranchId: gleem.BranchID,
    stats: stats[0],
    multiOpenEmployees: multiOpen.length,
    duplicateBranchEmpDate: dupBranchEmpDate.length,
    indexes,
    viewExists: !!viewExists[0]?.id,
    branchIdNullable: branchCol[0]?.is_nullable === true || branchCol[0]?.is_nullable === 1,
    activeBranches: active.map((r) => r.BranchCode),
    dailyPayrollCount: payrollCount[0],
    beforeRowCount: before?.stats?.rows ?? null,
  };

  const outPath = path.join(__dirname, '_phase1k-attendance-after.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ ...out, outPath }, null, 2));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
