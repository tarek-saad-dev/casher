/**
 * Audit July 2026 revenue-mapped incomes vs employee_funding ledger (SELECT only).
 */
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const config: sql.config = {
  server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
  port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || 'HawaiRestaurant',
  user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options: {
    encrypt: process.env.CLOUD_DB_ENCRYPT === 'true' || process.env.DB_ENCRYPT === 'true',
    trustServerCertificate:
      process.env.CLOUD_DB_TRUST_CERT === 'true' ||
      process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true,
  },
  connectionTimeout: 30000,
  requestTimeout: 120000,
};

async function main() {
  console.log('FLAG EMP_LEDGER_DUAL_WRITE_ENABLED=', process.env.EMP_LEDGER_DUAL_WRITE_ENABLED);
  console.log('DB', config.server, config.database);

  const pool = await sql.connect(config);

  const maps = await pool.request().query(`
    SELECT m.ID, m.EmpID, e.EmpName, m.ExpINID, c.CatName, m.TxnKind, m.IsActive
    FROM dbo.TblExpCatEmpMap m
    INNER JOIN dbo.TblExpINCat c ON c.ExpINID = m.ExpINID
    LEFT JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
    WHERE m.TxnKind = N'revenue'
    ORDER BY e.EmpName, c.CatName
  `);
  console.log('\n=== REVENUE MAPS ===');
  console.table(maps.recordset);

  const july = await pool.request().query(`
    SELECT
      ISNULL(c.CatName, N'?') AS CatName,
      map.EmpID,
      e.EmpName,
      COUNT(*) AS cnt,
      CAST(SUM(cm.GrandTolal) AS DECIMAL(12,2)) AS total,
      CAST(SUM(CASE WHEN ISNULL(cm.IsEmployeePayrollIncome,0)=1 THEN cm.GrandTolal ELSE 0 END) AS DECIMAL(12,2)) AS payrollMirror,
      CAST(SUM(CASE WHEN ISNULL(cm.IsEmployeePayrollIncome,0)=0 THEN cm.GrandTolal ELSE 0 END) AS DECIMAL(12,2)) AS nonPayroll
    FROM dbo.TblCashMove cm
    INNER JOIN dbo.TblExpINCat c ON c.ExpINID = cm.ExpINID
    CROSS APPLY (
      SELECT TOP 1 mm.EmpID
      FROM dbo.TblExpCatEmpMap mm
      WHERE mm.ExpINID = cm.ExpINID AND mm.IsActive = 1 AND mm.TxnKind = N'revenue'
      ORDER BY mm.ID DESC
    ) map
    LEFT JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
    WHERE cm.invType = N'ايرادات' AND cm.inOut = N'in'
      AND cm.invDate >= '2026-07-01' AND cm.invDate <= '2026-07-31'
    GROUP BY c.CatName, map.EmpID, e.EmpName
    ORDER BY total DESC
  `);
  console.log('\n=== JULY 2026 REVENUE-MAPPED BY CATEGORY ===');
  console.table(july.recordset);

  const funding = await pool.request().query(`
    SELECT e.EmpName, l.EmpID,
      CAST(SUM(l.Amount) AS DECIMAL(12,2)) AS fundingTotal,
      COUNT(*) AS cnt
    FROM dbo.TblEmpLedgerEntry l
    LEFT JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
    WHERE l.EntryReason = N'employee_funding' AND l.IsVoided = 0
      AND l.EntryDate >= '2026-07-01' AND l.EntryDate <= '2026-07-31'
    GROUP BY e.EmpName, l.EmpID
    ORDER BY fundingTotal DESC
  `);
  console.log('\n=== JULY 2026 EMPLOYEE_FUNDING LEDGER ===');
  console.table(funding.recordset);

  const missing = await pool.request().query(`
    SELECT cm.ID AS CashMoveID, CONVERT(varchar(10), cm.invDate, 23) AS invDate,
      CAST(cm.GrandTolal AS DECIMAL(12,2)) AS amount, c.CatName, map.EmpID, e.EmpName
    FROM dbo.TblCashMove cm
    INNER JOIN dbo.TblExpINCat c ON c.ExpINID = cm.ExpINID
    CROSS APPLY (
      SELECT TOP 1 mm.EmpID
      FROM dbo.TblExpCatEmpMap mm
      WHERE mm.ExpINID = cm.ExpINID AND mm.IsActive = 1 AND mm.TxnKind = N'revenue'
      ORDER BY mm.ID DESC
    ) map
    LEFT JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
    WHERE cm.invType = N'ايرادات' AND cm.inOut = N'in'
      AND cm.invDate >= '2026-07-01' AND cm.invDate <= '2026-07-31'
      AND ISNULL(cm.IsEmployeePayrollIncome,0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpLedgerEntry l
        WHERE l.CashMoveID = cm.ID AND l.EntryReason = N'employee_funding' AND l.IsVoided = 0
      )
    ORDER BY cm.invDate, cm.ID
  `);
  console.log('\n=== MISSING FUNDING ENTRIES ===', missing.recordset.length);
  console.table(missing.recordset);

  const totals = await pool.request().query(`
    SELECT
      CAST(ISNULL((
        SELECT SUM(cm.GrandTolal)
        FROM dbo.TblCashMove cm
        CROSS APPLY (
          SELECT TOP 1 1 AS ok
          FROM dbo.TblExpCatEmpMap mm
          WHERE mm.ExpINID = cm.ExpINID AND mm.IsActive = 1 AND mm.TxnKind = N'revenue'
        ) map
        WHERE cm.invType = N'ايرادات' AND cm.inOut = N'in'
          AND cm.invDate >= '2026-07-01' AND cm.invDate <= '2026-07-31'
          AND ISNULL(cm.IsEmployeePayrollIncome,0) = 0
      ), 0) AS DECIMAL(12,2)) AS linkedRevenueTotal,
      CAST(ISNULL((
        SELECT SUM(l.Amount)
        FROM dbo.TblEmpLedgerEntry l
        WHERE l.EntryReason = N'employee_funding' AND l.IsVoided = 0
          AND l.EntryDate >= '2026-07-01' AND l.EntryDate <= '2026-07-31'
      ), 0) AS DECIMAL(12,2)) AS ledgerFundingTotal
  `);
  console.log('\n=== TOTALS ===');
  console.table(totals.recordset);

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
