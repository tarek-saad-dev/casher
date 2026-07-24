/**
 * Phase 1L — live schema/fingerprint probe (read-only).
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const sql = require('mssql');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

function buildConfig() {
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 180000,
  };
}

async function main() {
  const pool = await sql.connect(buildConfig());
  const q = async (t) => (await pool.request().query(t)).recordset;
  const db = (await q('SELECT DB_NAME() AS n'))[0].n;
  if (db !== 'last132') throw new Error(`Expected last132, got ${db}`);

  const tables = [
    'TblEmpDailyPayroll',
    'TblEmpLedgerEntry',
    'TblEmpDailyTarget',
    'TblEmpTargetRecalcRequest',
    'TblEmpSalaryHistory',
    'TblEmpTargetPlan',
    'TblEmpTarget',
    'TblPayrollMonth',
    'TblEmpBranchPayrollPlan',
    'TblEmpTargetRule',
    'TblEmpCommission',
  ];

  const out = { database: db, capturedAt: new Date().toISOString(), tables: {} };

  for (const table of tables) {
    const exists = (await q(`SELECT OBJECT_ID(N'dbo.${table}', N'U') AS id`))[0].id;
    if (!exists) {
      out.tables[table] = { exists: false };
      continue;
    }
    const cols = await q(`
      SELECT c.name, ty.name AS type_name, c.is_nullable
      FROM sys.columns c
      JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      WHERE c.object_id = OBJECT_ID(N'dbo.${table}')
      ORDER BY c.column_id
    `);
    const idxs = await q(`
      SELECT i.name, i.is_unique, i.is_primary_key,
             STRING_AGG(c.name, N',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS cols
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID(N'dbo.${table}') AND i.name IS NOT NULL
      GROUP BY i.name, i.is_unique, i.is_primary_key
      ORDER BY i.name
    `);
    out.tables[table] = { exists: true, cols, idxs };
  }

  // Fingerprints
  const payCols = out.tables.TblEmpDailyPayroll?.cols?.map((c) => c.name) || [];
  const ledCols = out.tables.TblEmpLedgerEntry?.cols?.map((c) => c.name) || [];
  const tgtCols = out.tables.TblEmpDailyTarget?.cols?.map((c) => c.name) || [];

  out.payroll = (await q(`
    SELECT COUNT(*) AS rows,
           COUNT(DISTINCT EmpID) AS employees,
           ISNULL(SUM(CAST(DailyWage AS DECIMAL(18,4))),0) AS wageSum,
           ISNULL(SUM(CAST(ActualHours AS DECIMAL(18,4))),0) AS hoursSum
    FROM dbo.TblEmpDailyPayroll
  `))[0];

  out.payrollByStatus = await q(`
    SELECT Status, COUNT(*) AS c, ISNULL(SUM(CAST(DailyWage AS DECIMAL(18,4))),0) AS wageSum
    FROM dbo.TblEmpDailyPayroll GROUP BY Status
  `);

  out.payrollDupEmpDate = await q(`
    SELECT EmpID, WorkDate, COUNT(*) AS c
    FROM dbo.TblEmpDailyPayroll
    GROUP BY EmpID, WorkDate
    HAVING COUNT(*) > 1
  `);

  // Ledger amount column detection
  const amountCol = ledCols.find((n) =>
    ['Amount', 'EntryAmount', 'Credit', 'Debit'].includes(n),
  );
  const reasonCol = ledCols.find((n) =>
    ['EntryReason', 'Reason', 'EntryType', 'Type'].includes(n),
  );
  out.ledgerMeta = { amountCol, reasonCol, ledCols };

  if (amountCol) {
    out.ledger = (await q(`
      SELECT COUNT(*) AS rows,
             COUNT(DISTINCT EmpID) AS employees,
             ISNULL(SUM(CASE WHEN [${amountCol}] > 0 THEN CAST([${amountCol}] AS DECIMAL(18,4)) ELSE 0 END),0) AS credits,
             ISNULL(SUM(CASE WHEN [${amountCol}] < 0 THEN CAST(-[${amountCol}] AS DECIMAL(18,4)) ELSE 0 END),0) AS debits
      FROM dbo.TblEmpLedgerEntry
    `))[0];
    if (reasonCol) {
      out.ledgerByReason = await q(`
        SELECT [${reasonCol}] AS reason, COUNT(*) AS c,
               ISNULL(SUM(CAST([${amountCol}] AS DECIMAL(18,4))),0) AS amountSum
        FROM dbo.TblEmpLedgerEntry
        GROUP BY [${reasonCol}]
        ORDER BY c DESC
      `);
    }
  }

  if (out.tables.TblEmpDailyTarget?.exists) {
    out.targets = (await q(`SELECT COUNT(*) AS rows FROM dbo.TblEmpDailyTarget`))[0];
    out.targetDupEmpDate = await q(`
      SELECT EmpID, WorkDate, COUNT(*) AS c
      FROM dbo.TblEmpDailyTarget
      GROUP BY EmpID, WorkDate
      HAVING COUNT(*) > 1
    `).catch(() => []);
  }

  if (out.tables.TblEmpTargetRecalcRequest?.exists) {
    out.recalc = (await q(`SELECT COUNT(*) AS rows FROM dbo.TblEmpTargetRecalcRequest`))[0];
  }

  out.branches = await q(`SELECT BranchID, BranchCode, IsActive FROM dbo.TblBranch ORDER BY BranchID`);

  // CashMove linked ledger sample if CashMoveID exists
  if (ledCols.includes('CashMoveID')) {
    out.ledgerCashLinked = (await q(`
      SELECT COUNT(*) AS c FROM dbo.TblEmpLedgerEntry WHERE CashMoveID IS NOT NULL
    `))[0];
  }

  const outPath = path.join(
    process.cwd(),
    'scripts',
    'audit-branches',
    '_phase1l-probe.json',
  );
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({
    database: out.database,
    branches: out.branches,
    payroll: out.payroll,
    payrollDupEmpDate: out.payrollDupEmpDate.length,
    ledger: out.ledger,
    ledgerMeta: out.ledgerMeta,
    targets: out.targets,
    recalc: out.recalc,
    tablePresence: Object.fromEntries(
      Object.entries(out.tables).map(([k, v]) => [k, v.exists]),
    ),
    outPath,
  }, null, 2));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
