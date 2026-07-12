#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * Remaining issues DB probe — SELECT only. Writes markdown snippet to stdout
 * and docs/remaining-financial-payroll-issues-db-probe-YYYY-MM.md
 */

import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import dotenv from 'dotenv';
import { getMonthDateRange } from '../src/lib/reportMonthUtils';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const WRITE_PATTERN = /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|EXEC|EXECUTE)\b/i;

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
  requestTimeout: 180000,
};

function parseArgs(argv: string[]) {
  let month: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith('--month=')) month = arg.slice(8);
  }
  return { month };
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

async function q(pool: sql.ConnectionPool, text: string, binds?: Record<string, unknown>) {
  if (WRITE_PATTERN.test(text) || !/^\s*SELECT\b/i.test(text.trim())) {
    throw new Error('READ-ONLY VIOLATION');
  }
  const req = pool.request();
  if (binds) {
    for (const [k, v] of Object.entries(binds)) {
      if (k.includes('Date') || k.includes('date') || k === 'monthStart' || k === 'monthEnd') {
        req.input(k, sql.Date, v);
      } else if (typeof v === 'number') {
        req.input(k, sql.Int, v);
      } else {
        req.input(k, sql.NVarChar(50), v);
      }
    }
  }
  return req.query(text);
}

async function main() {
  const { month } = parseArgs(process.argv.slice(2));
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error('Usage: node scripts/audit-remaining-financial-payroll-issues.js --month=YYYY-MM');
    process.exit(1);
  }
  const [y, m] = month.split('-').map(Number);
  const { startDate, endDate } = getMonthDateRange(y, m);

  console.log('Remaining Issues DB Probe (READ-ONLY)');
  console.log('Month:', month, startDate, '→', endDate);
  console.log('Flags:', {
    EMP_LEDGER_DUAL_WRITE_ENABLED: process.env.EMP_LEDGER_DUAL_WRITE_ENABLED,
    EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH: process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH,
    FINANCIAL_REPORT_CLASSIFICATION_ENABLED: process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED,
  });

  const pool = await sql.connect(config);
  const out: string[] = [];
  const push = (s: string) => {
    out.push(s);
    console.log(s);
  };

  try {
    // Ledger by reason
    const credits = await q(
      pool,
      `
      SELECT l.EntryReason, COUNT(*) AS cnt, ISNULL(SUM(l.Amount),0) AS total
      FROM dbo.TblEmpLedgerEntry l
      WHERE l.IsVoided = 0 AND l.EntryDirection = N'credit'
        AND (
          l.PayrollMonth = @month
          OR (l.PayrollMonth IS NULL AND l.EntryDate >= @monthStart AND l.EntryDate <= @monthEnd)
        )
      GROUP BY l.EntryReason
      ORDER BY total DESC
      `,
      { month, monthStart: startDate, monthEnd: endDate },
    );
    push('\n## Ledger credits by EntryReason');
    console.table(credits.recordset);

    const debits = await q(
      pool,
      `
      SELECT l.EntryReason, COUNT(*) AS cnt, ISNULL(SUM(l.Amount),0) AS total
      FROM dbo.TblEmpLedgerEntry l
      WHERE l.IsVoided = 0 AND l.EntryDirection = N'debit'
        AND (
          l.PayrollMonth = @month
          OR (l.PayrollMonth IS NULL AND l.EntryDate >= @monthStart AND l.EntryDate <= @monthEnd)
        )
      GROUP BY l.EntryReason
      ORDER BY total DESC
      `,
      { month, monthStart: startDate, monthEnd: endDate },
    );
    push('\n## Ledger debits by EntryReason');
    console.table(debits.recordset);

    // Monthly salary integrity
    const monthlySalary = await q(
      pool,
      `
      SELECT
        COUNT(*) AS entryCount,
        ISNULL(SUM(l.Amount),0) AS totalAmount,
        SUM(CASE WHEN l.CashMoveID IS NOT NULL THEN 1 ELSE 0 END) AS withCashMove,
        COUNT(DISTINCT l.EmpID) AS empCount
      FROM dbo.TblEmpLedgerEntry l
      WHERE l.IsVoided = 0
        AND l.EntryReason = N'monthly_salary'
        AND l.EntryDirection = N'credit'
        AND (l.PayrollMonth = @month OR l.RefType = N'MonthlySalary:' + @month)
      `,
      { month },
    );
    push('\n## Monthly salary credits');
    console.table(monthlySalary.recordset);

    const monthlyDupes = await q(
      pool,
      `
      SELECT l.EmpID, e.EmpName, COUNT(*) AS activeCount
      FROM dbo.TblEmpLedgerEntry l
      LEFT JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
      WHERE l.IsVoided = 0
        AND l.EntryReason = N'monthly_salary'
        AND l.RefType = N'MonthlySalary:' + @month
      GROUP BY l.EmpID, e.EmpName
      HAVING COUNT(*) > 1
      `,
      { month },
    );
    push('\n## Duplicate monthly_salary active (should be empty)');
    console.table(monthlyDupes.recordset.length ? monthlyDupes.recordset : [{ note: '(none)' }]);

    const monthlyEligible = await q(
      pool,
      `
      SELECT e.EmpID, e.EmpName, e.IsActive,
        e.EmploymentType, e.PayrollMethod, e.BaseSalary, e.SalaryType
      FROM dbo.TblEmp e
      WHERE e.IsActive = 1
        AND (
          LOWER(ISNULL(e.PayrollMethod, N'')) = N'monthly'
          OR LOWER(ISNULL(e.SalaryType, N'')) LIKE N'%شهر%'
          OR LOWER(ISNULL(e.SalaryType, N'')) = N'monthly'
        )
        AND LOWER(ISNULL(e.EmploymentType, N'')) <> N'freelance'
      ORDER BY e.EmpName
      `,
    );
    push('\n## Active monthly-eligible employees');
    console.table(monthlyEligible.recordset);

    const missingMonthly = await q(
      pool,
      `
      SELECT e.EmpID, e.EmpName, e.BaseSalary, e.PayrollMethod
      FROM dbo.TblEmp e
      WHERE e.IsActive = 1
        AND (
          LOWER(ISNULL(e.PayrollMethod, N'')) = N'monthly'
          OR LOWER(ISNULL(e.SalaryType, N'')) LIKE N'%شهر%'
          OR LOWER(ISNULL(e.SalaryType, N'')) = N'monthly'
        )
        AND LOWER(ISNULL(e.EmploymentType, N'')) <> N'freelance'
        AND ISNULL(e.BaseSalary, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpLedgerEntry l
          WHERE l.IsVoided = 0
            AND l.EmpID = e.EmpID
            AND l.EntryReason = N'monthly_salary'
            AND l.RefType = N'MonthlySalary:' + @month
        )
      ORDER BY e.EmpName
      `,
      { month },
    );
    push('\n## Monthly eligible missing monthly_salary ledger entry');
    console.table(missingMonthly.recordset.length ? missingMonthly.recordset : [{ note: '(none)' }]);

    // Advance/payout cash links
    const advanceLinks = await q(
      pool,
      `
      SELECT
        COUNT(*) AS advances,
        SUM(CASE WHEN CashMoveID IS NULL THEN 1 ELSE 0 END) AS missingCashMove,
        ISNULL(SUM(Amount),0) AS total
      FROM dbo.TblEmpLedgerEntry
      WHERE IsVoided = 0 AND EntryReason = N'advance' AND EntryDirection = N'debit'
        AND EntryDate >= @monthStart AND EntryDate <= @monthEnd
      `,
      { monthStart: startDate, monthEnd: endDate },
    );
    push('\n## Advance debit cash links (month by EntryDate)');
    console.table(advanceLinks.recordset);

    const payoutLinks = await q(
      pool,
      `
      SELECT
        COUNT(*) AS payouts,
        SUM(CASE WHEN CashMoveID IS NULL THEN 1 ELSE 0 END) AS missingCashMove,
        ISNULL(SUM(Amount),0) AS total
      FROM dbo.TblEmpLedgerEntry
      WHERE IsVoided = 0 AND EntryReason = N'payout' AND EntryDirection = N'debit'
        AND EntryDate >= @monthStart AND EntryDate <= @monthEnd
      `,
      { monthStart: startDate, monthEnd: endDate },
    );
    push('\n## Payout debit cash links');
    console.table(payoutLinks.recordset);

    // Unexpected amounts
    const badAmounts = await q(
      pool,
      `
      SELECT TOP 20 ID, EmpID, EntryReason, EntryDirection, Amount, IsVoided
      FROM dbo.TblEmpLedgerEntry
      WHERE IsVoided = 0
        AND (
          Amount <= 0
          OR (
            PayrollMonth = @month
            OR (PayrollMonth IS NULL AND EntryDate >= @monthStart AND EntryDate <= @monthEnd)
          ) AND Amount <= 0
        )
        AND (
          PayrollMonth = @month
          OR (PayrollMonth IS NULL AND EntryDate >= @monthStart AND EntryDate <= @monthEnd)
        )
      `,
      { month, monthStart: startDate, monthEnd: endDate },
    );
    push('\n## Non-positive active ledger amounts in month');
    console.table(badAmounts.recordset.length ? badAmounts.recordset : [{ note: '(none)' }]);

    // Inactive with monthly salary credit
    const inactiveMonthly = await q(
      pool,
      `
      SELECT e.EmpID, e.EmpName, e.IsActive, l.Amount, l.RefType
      FROM dbo.TblEmpLedgerEntry l
      INNER JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
      WHERE l.IsVoided = 0
        AND l.EntryReason = N'monthly_salary'
        AND l.RefType = N'MonthlySalary:' + @month
        AND ISNULL(e.IsActive, 0) = 0
      `,
      { month },
    );
    push('\n## Inactive employees with monthly_salary credit');
    console.table(inactiveMonthly.recordset.length ? inactiveMonthly.recordset : [{ note: '(none)' }]);

    // Data quality employees
    const dq = await q(
      pool,
      `
      SELECT
        SUM(CASE WHEN IsActive=1 AND (EmploymentType IS NULL OR LTRIM(RTRIM(EmploymentType))=N'') THEN 1 ELSE 0 END) AS activeMissingEmploymentType,
        SUM(CASE WHEN IsActive=1 AND (PayrollMethod IS NULL OR LTRIM(RTRIM(PayrollMethod))=N'') THEN 1 ELSE 0 END) AS activeMissingPayrollMethod,
        SUM(CASE WHEN IsActive=1 AND LOWER(ISNULL(PayrollMethod,N''))=N'monthly' AND ISNULL(BaseSalary,0)<=0 THEN 1 ELSE 0 END) AS monthlyNoBaseSalary,
        SUM(CASE WHEN IsActive=1 AND LOWER(ISNULL(PayrollMethod,N''))=N'hourly'
          AND ISNULL(ManualHourlyRate,0)<=0 AND ISNULL(HourlyRate,0)<=0 THEN 1 ELSE 0 END) AS hourlyNoRate,
        SUM(CASE WHEN IsActive=1 AND LOWER(ISNULL(PayrollMethod,N''))=N'daily' AND ISNULL(DailyRate,0)<=0 THEN 1 ELSE 0 END) AS dailyNoRate,
        SUM(CASE WHEN IsActive=1 AND LOWER(ISNULL(EmploymentType,N''))=N'freelance'
          AND LOWER(ISNULL(PayrollMethod,N''))=N'monthly' THEN 1 ELSE 0 END) AS freelanceMonthlyViolations,
        SUM(CASE WHEN IsActive=0 AND ISNULL(IsPayrollEnabled,1)=1 THEN 1 ELSE 0 END) AS inactivePayrollEnabled,
        COUNT(*) AS totalEmployees
      FROM dbo.TblEmp
      `,
    );
    push('\n## Employee data quality counts');
    console.table(dq.recordset);

    // Categories
    const cats = await q(
      pool,
      `
      SELECT
        SUM(CASE WHEN m.TxnKind = N'revenue' AND m.IsActive=1 THEN 1 ELSE 0 END) AS activeRevenueMaps,
        SUM(CASE WHEN m.TxnKind = N'advance' AND m.IsActive=1 THEN 1 ELSE 0 END) AS activeAdvanceMaps,
        SUM(CASE WHEN m.IsActive=1 AND (m.TxnKind IS NULL OR LTRIM(RTRIM(m.TxnKind))=N'') THEN 1 ELSE 0 END) AS activeMapsMissingTxnKind,
        (SELECT COUNT(*) FROM dbo.TblExpINCat WHERE CatName = N'صرف مستحقات الموظفين') AS payoutCategoryExists,
        (SELECT COUNT(*) FROM dbo.TblExpINCat WHERE CatName = N'تمويل من موظف') AS fundingCategoryExists
      FROM dbo.TblExpCatEmpMap m
      `,
    );
    push('\n## Category / mapping quality');
    console.table(cats.recordset);

    // Voided in month still present
    const voided = await q(
      pool,
      `
      SELECT COUNT(*) AS voidedCount, ISNULL(SUM(Amount),0) AS voidedAmount
      FROM dbo.TblEmpLedgerEntry
      WHERE IsVoided = 1
        AND (
          PayrollMonth = @month
          OR (PayrollMonth IS NULL AND EntryDate >= @monthStart AND EntryDate <= @monthEnd)
        )
      `,
      { month, monthStart: startDate, monthEnd: endDate },
    );
    push('\n## Voided ledger entries in month scope (should not affect totals)');
    console.table(voided.recordset);

    // Duplicate RefType/RefID/EntryReason active
    const dupRefs = await q(
      pool,
      `
      SELECT TOP 20 RefType, RefID, EntryReason, COUNT(*) AS cnt
      FROM dbo.TblEmpLedgerEntry
      WHERE IsVoided = 0 AND RefType IS NOT NULL AND RefID IS NOT NULL
      GROUP BY RefType, RefID, EntryReason
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      `,
    );
    push('\n## Duplicate active RefType/RefID/EntryReason (top 20)');
    console.table(dupRefs.recordset.length ? dupRefs.recordset : [{ note: '(none)' }]);

    const probePath = path.join(
      __dirname,
      '..',
      'docs',
      `remaining-financial-payroll-issues-db-probe-${month}.md`,
    );
    const md = `# DB Probe — Remaining Issues — ${month}

Generated: ${new Date().toISOString()}
Mode: READ-ONLY SELECT

## Flags
\`\`\`
EMP_LEDGER_DUAL_WRITE_ENABLED=${process.env.EMP_LEDGER_DUAL_WRITE_ENABLED}
EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH=${process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH}
FINANCIAL_REPORT_CLASSIFICATION_ENABLED=${process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED}
\`\`\`

## Ledger credits
${credits.recordset.map((r: Record<string, unknown>) => `- ${r.EntryReason}: count=${r.cnt} total=${fmt(Number(r.total))}`).join('\n') || '(none)'}

## Ledger debits
${debits.recordset.map((r: Record<string, unknown>) => `- ${r.EntryReason}: count=${r.cnt} total=${fmt(Number(r.total))}`).join('\n') || '(none)'}

## Monthly salary
\`\`\`json
${JSON.stringify(monthlySalary.recordset[0] ?? {}, null, 2)}
\`\`\`
Duplicates: ${monthlyDupes.recordset.length}
Missing eligible: ${missingMonthly.recordset.length}
Inactive with credit: ${inactiveMonthly.recordset.length}

## Advances / Payouts
\`\`\`json
${JSON.stringify({ advances: advanceLinks.recordset[0], payouts: payoutLinks.recordset[0] }, null, 2)}
\`\`\`

## Employee DQ
\`\`\`json
${JSON.stringify(dq.recordset[0] ?? {}, null, 2)}
\`\`\`

## Categories
\`\`\`json
${JSON.stringify(cats.recordset[0] ?? {}, null, 2)}
\`\`\`

## Duplicate active refs
Count groups: ${dupRefs.recordset.length}

## Non-positive amounts
Count: ${badAmounts.recordset.length}
`;
    fs.writeFileSync(probePath, md, 'utf8');
    console.log('\nWrote', probePath);
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
