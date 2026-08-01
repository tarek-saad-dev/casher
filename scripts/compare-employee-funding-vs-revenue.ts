/**
 * Compare employee-mapped revenues (all-revenue style) vs ledger «تمويل للمحل» per employee.
 * SELECT only.
 */
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const month = process.argv[2] || '2026-07';
const [y, m] = month.split('-').map(Number);
const startDate = `${month}-01`;
const endDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

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
  console.log('Month', month, `(${startDate} → ${endDate})`);
  console.log('FLAG', process.env.EMP_LEDGER_DUAL_WRITE_ENABLED);
  console.log('DB', config.server, config.database);

  const pool = await sql.connect(config);

  const maps = await pool.request().query(`
    SELECT m.EmpID, e.EmpName, m.ExpINID, c.CatName, m.IsActive
    FROM dbo.TblExpCatEmpMap m
    INNER JOIN dbo.TblExpINCat c ON c.ExpINID = m.ExpINID AND c.ExpINType = N'ايرادات'
    LEFT JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
    WHERE m.TxnKind = N'revenue'
    ORDER BY e.EmpName, c.CatName
  `);
  console.log('\n=== REVENUE EMP MAPS ===');
  console.table(maps.recordset);

  // Same idea as funding recon: revenue-mapped incomes (non payroll mirror) by emp
  const linked = await pool.request()
    .input('start', sql.Date, startDate)
    .input('end', sql.Date, endDate)
    .query(`
      SELECT
        map.EmpID,
        ISNULL(e.EmpName, N'?') AS EmpName,
        CAST(SUM(CASE WHEN ISNULL(cm.IsEmployeePayrollIncome,0)=0 THEN cm.GrandTolal ELSE 0 END) AS DECIMAL(12,2)) AS linkedRevenue,
        CAST(SUM(CASE WHEN ISNULL(cm.IsEmployeePayrollIncome,0)=1 THEN cm.GrandTolal ELSE 0 END) AS DECIMAL(12,2)) AS payrollMirror,
        COUNT(*) AS incomeCount
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpINCat c ON c.ExpINID = cm.ExpINID AND c.ExpINType = N'ايرادات'
      CROSS APPLY (
        SELECT TOP 1 mm.EmpID
        FROM dbo.TblExpCatEmpMap mm
        WHERE mm.ExpINID = cm.ExpINID AND mm.IsActive = 1 AND mm.TxnKind = N'revenue'
        ORDER BY mm.ID DESC
      ) map
      LEFT JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
      WHERE cm.invType = N'ايرادات' AND cm.inOut = N'in'
        AND cm.invDate >= @start AND cm.invDate <= @end
      GROUP BY map.EmpID, e.EmpName
    `);

  // Ledger funding column (employee_funding + tip) — matches summary SQL intent by EntryDate / PayrollMonth
  const funding = await pool.request()
    .input('month', sql.NVarChar(7), month)
    .input('start', sql.Date, startDate)
    .input('end', sql.Date, endDate)
    .query(`
      SELECT
        l.EmpID,
        ISNULL(e.EmpName, N'?') AS EmpName,
        CAST(SUM(CASE WHEN l.EntryReason = N'employee_funding' THEN l.Amount ELSE 0 END) AS DECIMAL(12,2)) AS fundingOnly,
        CAST(SUM(CASE WHEN l.EntryReason = N'tip' THEN l.Amount ELSE 0 END) AS DECIMAL(12,2)) AS tipOnly,
        CAST(SUM(l.Amount) AS DECIMAL(12,2)) AS fundingCredits,
        COUNT(*) AS entryCount
      FROM dbo.TblEmpLedgerEntry l
      LEFT JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
      WHERE l.IsVoided = 0
        AND l.EntryReason IN (N'employee_funding', N'tip')
        AND (
          l.PayrollMonth = @month
          OR (l.PayrollMonth IS NULL AND l.EntryDate >= @start AND l.EntryDate <= @end)
        )
      GROUP BY l.EmpID, e.EmpName
    `);

  // Funding-like categories without revenue map (سد *) — gap candidates on all-revenue
  const unmappedSad = await pool.request()
    .input('start', sql.Date, startDate)
    .input('end', sql.Date, endDate)
    .query(`
      SELECT
        ISNULL(c.CatName, N'?') AS CatName,
        COUNT(*) AS cnt,
        CAST(SUM(cm.GrandTolal) AS DECIMAL(12,2)) AS total
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblExpINCat c ON c.ExpINID = cm.ExpINID
      WHERE cm.invType = N'ايرادات' AND cm.inOut = N'in'
        AND cm.invDate >= @start AND cm.invDate <= @end
        AND ISNULL(cm.IsEmployeePayrollIncome,0) = 0
        AND (
          c.CatName LIKE N'سد %'
          OR c.CatName LIKE N'سداد%'
          OR c.CatName LIKE N'%تمويل%'
        )
        AND c.CatName <> N'تمويل من موظف'
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblExpCatEmpMap m
          WHERE m.ExpINID = cm.ExpINID AND m.IsActive = 1 AND m.TxnKind = N'revenue'
        )
      GROUP BY c.CatName
      ORDER BY total DESC
    `);

  type Row = {
    EmpID: number;
    EmpName: string;
    linkedRevenue: number;
    payrollMirror: number;
    fundingOnly: number;
    tipOnly: number;
    fundingCredits: number;
    difference: number;
  };

  const byEmp = new Map<number, Row>();

  for (const r of linked.recordset as any[]) {
    byEmp.set(Number(r.EmpID), {
      EmpID: Number(r.EmpID),
      EmpName: String(r.EmpName),
      linkedRevenue: Number(r.linkedRevenue) || 0,
      payrollMirror: Number(r.payrollMirror) || 0,
      fundingOnly: 0,
      tipOnly: 0,
      fundingCredits: 0,
      difference: 0,
    });
  }
  for (const r of funding.recordset as any[]) {
    const id = Number(r.EmpID);
    const existing = byEmp.get(id) ?? {
      EmpID: id,
      EmpName: String(r.EmpName),
      linkedRevenue: 0,
      payrollMirror: 0,
      fundingOnly: 0,
      tipOnly: 0,
      fundingCredits: 0,
      difference: 0,
    };
    existing.fundingOnly = Number(r.fundingOnly) || 0;
    existing.tipOnly = Number(r.tipOnly) || 0;
    existing.fundingCredits = Number(r.fundingCredits) || 0;
    byEmp.set(id, existing);
  }

  const rows = [...byEmp.values()].map((r) => ({
    ...r,
    // Compare EmpMap incomes (excl payroll mirror) vs employee_funding only (not tips)
    difference: Math.round((r.linkedRevenue - r.fundingOnly) * 100) / 100,
  })).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.EmpName.localeCompare(b.EmpName, 'ar'));

  console.log('\n=== PER EMPLOYEE: linked revenue (EmpMap) vs تمويل للمحل (employee_funding) ===');
  console.table(rows.map((r) => ({
    EmpName: r.EmpName,
    EmpMapإيرادات: r.linkedRevenue,
    تمويل_دفتر: r.fundingOnly,
    تبس: r.tipOnly,
    عمود_تمويل_للمحل: r.fundingCredits,
    فرق_إيرادات_ناقص_تمويل: r.difference,
    payrollMirror: r.payrollMirror,
  })));

  const mismatches = rows.filter((r) => Math.abs(r.difference) >= 0.01);
  const sumLinked = rows.reduce((s, r) => s + r.linkedRevenue, 0);
  const sumFunding = rows.reduce((s, r) => s + r.fundingOnly, 0);

  console.log('\n=== TOTALS ===');
  console.log({
    linkedRevenueTotal: sumLinked,
    ledgerFundingOnlyTotal: sumFunding,
    difference: Math.round((sumLinked - sumFunding) * 100) / 100,
    mismatchEmployees: mismatches.length,
  });

  console.log('\n=== UNMAPPED سد/تمويل ON ALL-REVENUE (gap risk) ===');
  console.table(unmappedSad.recordset);

  if (mismatches.length) {
    console.log('\n=== MISMATCH DETAIL ===');
    for (const r of mismatches) {
      console.log(`- ${r.EmpName}: إيرادات مربوطة ${r.linkedRevenue} ≠ تمويل دفتر ${r.fundingOnly} (فرق ${r.difference})`);
    }
  } else {
    console.log('\nAll mapped employees match (linked revenue ≈ employee_funding).');
  }

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
