/**
 * Phase 1K — attendance before fingerprint (read-only).
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

  const cols = await q(`
    SELECT c.name, ty.name AS type_name, c.is_nullable, c.max_length, c.precision, c.scale
    FROM sys.columns c
    JOIN sys.types ty ON c.user_type_id = ty.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
    ORDER BY c.column_id
  `);

  const indexes = await q(`
    SELECT i.name, i.is_unique, i.is_primary_key, i.has_filter, i.filter_definition,
           STRING_AGG(c.name, N',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS cols
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID(N'dbo.TblEmpAttendance') AND i.name IS NOT NULL
    GROUP BY i.name, i.is_unique, i.is_primary_key, i.has_filter, i.filter_definition
    ORDER BY i.name
  `);

  const fks = await q(`
    SELECT fk.name, OBJECT_NAME(fk.referenced_object_id) AS ref_table,
           COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS col,
           COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ref_col
    FROM sys.foreign_keys fk
    INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    WHERE fk.parent_object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
  `);

  const stats = await q(`
    SELECT
      COUNT(*) AS rows,
      COUNT(DISTINCT EmpID) AS employees,
      MIN(WorkDate) AS minWorkDate,
      MAX(WorkDate) AS maxWorkDate,
      SUM(CASE WHEN CheckOutTime IS NULL THEN 1 ELSE 0 END) AS openNullCheckout,
      SUM(CASE WHEN CheckInTime IS NULL THEN 1 ELSE 0 END) AS nullCheckIn
    FROM dbo.TblEmpAttendance
  `);

  // Discover actual column names for checkout/status if different
  const colNames = cols.map((c) => c.name);

  const dupEmpDate = await q(`
    SELECT EmpID, WorkDate, COUNT(*) AS c
    FROM dbo.TblEmpAttendance
    GROUP BY EmpID, WorkDate
    HAVING COUNT(*) > 1
  `);

  const branches = await q(`
    SELECT BranchID, BranchCode, IsActive FROM dbo.TblBranch ORDER BY BranchID
  `);

  const hasBranchId = colNames.some((n) => n.toLowerCase() === 'branchid');

  const assignmentCols = await q(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblEmpBranchAssignment')
    ORDER BY c.column_id
  `).catch(() => []);

  const out = {
    capturedAt: new Date().toISOString(),
    database,
    branches,
    hasBranchId,
    cols,
    indexes,
    fks,
    stats: stats[0],
    duplicateEmpWorkDate: dupEmpDate.length,
    duplicateSamples: dupEmpDate.slice(0, 20),
    assignmentCols: assignmentCols.map((r) => r.name),
  };

  // Status distribution if Status-like column exists
  for (const candidate of ['Status', 'AttendanceStatus', 'AttStatus', 'State']) {
    if (colNames.includes(candidate)) {
      out[`dist_${candidate}`] = await q(
        `SELECT [${candidate}] AS v, COUNT(*) AS c FROM dbo.TblEmpAttendance GROUP BY [${candidate}]`,
      );
    }
  }

  // Sample open rows
  const checkoutCol = colNames.find((n) => /checkout/i.test(n)) || 'CheckOutTime';
  if (colNames.includes(checkoutCol)) {
    out.openSample = await q(`
      SELECT TOP 5 * FROM dbo.TblEmpAttendance
      WHERE [${checkoutCol}] IS NULL
      ORDER BY WorkDate DESC
    `);
  }

  // Payroll daily count fingerprint
  const payrollExists = await q(`
    SELECT OBJECT_ID(N'dbo.TblEmpDailyPayroll', N'U') AS id
  `);
  if (payrollExists[0]?.id) {
    out.dailyPayrollCount = (
      await q(`SELECT COUNT(*) AS c FROM dbo.TblEmpDailyPayroll`)
    )[0];
  }

  const outPath = path.join(__dirname, '_phase1k-attendance-before.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(
    JSON.stringify(
      {
        database,
        hasBranchId,
        stats: out.stats,
        duplicateEmpWorkDate: out.duplicateEmpWorkDate,
        indexNames: indexes.map((i) => ({ name: i.name, unique: i.is_unique, cols: i.cols })),
        assignmentCols: out.assignmentCols,
        dailyPayrollCount: out.dailyPayrollCount,
        outPath,
      },
      null,
      2,
    ),
  );
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
