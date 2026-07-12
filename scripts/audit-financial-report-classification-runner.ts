#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * Phase 5A financial report classification runner (READ-ONLY).
 */

import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';
import { getMonthDateRange } from '../src/lib/reportMonthUtils';
import {
  classifyCashMoveForFinancialAudit,
  classifyCategoryForFinancialAudit,
  READ_ONLY_FINANCIAL_AUDIT_GUARD,
} from '../src/lib/accounting/financialReportClassificationAudit';

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

function parseArgs(argv: string[]) {
  let month: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith('--month=')) month = arg.slice('--month='.length);
  }
  return { month };
}

function section(title: string) {
  console.log('\n' + '═'.repeat(72));
  console.log(title);
  console.log('═'.repeat(72));
}

function fmt(n: number) {
  return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

async function main() {
  if (!READ_ONLY_FINANCIAL_AUDIT_GUARD.allowWrites) {
    // guard for tests
  }

  const { month } = parseArgs(process.argv.slice(2));
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error('Usage: node scripts/audit-financial-report-classification.js --month=YYYY-MM');
    process.exit(1);
  }

  if (!config.server || !config.user) {
    console.error('Missing DB credentials in .env / .env.local');
    process.exit(1);
  }

  const [yearStr, monthStr] = month.split('-');
  const { startDate, endDate } = getMonthDateRange(parseInt(yearStr, 10), parseInt(monthStr, 10));

  console.log('Financial Report Classification Audit (READ-ONLY) — Phase 5A');
  console.log('Month:', month, `(${startDate} → ${endDate})`);
  console.log('Database:', config.database, '@', config.server);
  console.log('Guards: writes=OFF cashMove=OFF ledger=OFF');

  const pool = await sql.connect(config);

  try {
    const totals = await pool.request()
      .input('startDate', sql.Date, startDate)
      .input('endDate', sql.Date, endDate)
      .query(`
        SELECT
          ISNULL(SUM(CASE WHEN inOut = N'in' THEN GrandTolal ELSE 0 END), 0) AS totalIn,
          ISNULL(SUM(CASE WHEN inOut = N'out' THEN GrandTolal ELSE 0 END), 0) AS totalOut,
          ISNULL(SUM(CASE WHEN inOut = N'in' AND invType = N'مبيعات' THEN GrandTolal ELSE 0 END), 0) AS salesIn,
          ISNULL(SUM(CASE WHEN ISNULL(IsEmployeePayrollIncome,0)=1 THEN GrandTolal ELSE 0 END), 0) AS legacyIncomeMirror,
          ISNULL(SUM(CASE WHEN ISNULL(IsPayrollDeduction,0)=1 THEN GrandTolal ELSE 0 END), 0) AS legacyPayrollExpense
        FROM dbo.TblCashMove
        WHERE invDate >= @startDate AND invDate <= @endDate
      `);

    section('Month totals (TblCashMove)');
    console.table(totals.recordset);

    const moves = await pool.request()
      .input('startDate', sql.Date, startDate)
      .input('endDate', sql.Date, endDate)
      .query(`
        SELECT
          cm.ID,
          cm.invType,
          cm.inOut,
          cm.GrandTolal AS amount,
          ISNULL(cat.CatName, N'') AS categoryName,
          ISNULL(cm.IsPayrollDeduction, 0) AS isPayrollDeduction,
          ISNULL(cm.IsEmployeePayrollIncome, 0) AS isEmployeePayrollIncome,
          cm.EmpID AS empId,
          map.TxnKind AS txnKind,
          map.EmpID AS empIdFromMap
        FROM dbo.TblCashMove cm
        LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
        OUTER APPLY (
          SELECT TOP 1 m.TxnKind, m.EmpID
          FROM dbo.TblExpCatEmpMap m
          WHERE m.ExpINID = cm.ExpINID AND m.IsActive = 1
          ORDER BY m.ID DESC
        ) map
        WHERE cm.invDate >= @startDate AND cm.invDate <= @endDate
      `);

    const classified = moves.recordset.map((row: Record<string, unknown>) => {
      const amount = Number(row.amount ?? 0);
      const audit = classifyCashMoveForFinancialAudit({
        invType: String(row.invType ?? ''),
        inOut: String(row.inOut ?? ''),
        categoryName: String(row.categoryName ?? ''),
        isPayrollDeduction: row.isPayrollDeduction === 1 || row.isPayrollDeduction === true,
        isEmployeePayrollIncome: row.isEmployeePayrollIncome === 1 || row.isEmployeePayrollIncome === true,
        txnKind: row.txnKind != null ? String(row.txnKind) : null,
        empIdFromMap: row.empIdFromMap != null ? Number(row.empIdFromMap) : null,
        empId: row.empId != null ? Number(row.empId) : null,
      });
      return { amount, ...audit };
    });

    const buckets: Record<string, number> = {
      sales_revenue: 0,
      other_business_income: 0,
      non_revenue_cash_in: 0,
      legacy_employee_income_mirror: 0,
      operating_expense: 0,
      employee_advance: 0,
      employee_payout: 0,
      legacy_payroll_expense: 0,
      non_expense_cash_out: 0,
      unknown: 0,
    };

    let totalInClassified = 0;
    let totalOutClassified = 0;

    for (const row of classified) {
      if (row.revenueClass) {
        totalInClassified += row.amount;
        buckets[row.revenueClass] = (buckets[row.revenueClass] ?? 0) + row.amount;
      } else if (row.expenseClass) {
        totalOutClassified += row.amount;
        buckets[row.expenseClass] = (buckets[row.expenseClass] ?? 0) + row.amount;
      } else {
        buckets.unknown += row.amount;
      }
    }

    section('Classification guess totals');
    console.table([
      { bucket: 'likely sales revenue', amount: fmt(buckets.sales_revenue) },
      { bucket: 'other business income (CashMove)', amount: fmt(buckets.other_business_income) },
      { bucket: 'non-revenue cash-in', amount: fmt(buckets.non_revenue_cash_in) },
      { bucket: 'legacy employee income mirror', amount: fmt(buckets.legacy_employee_income_mirror) },
      { bucket: 'operating expense', amount: fmt(buckets.operating_expense) },
      { bucket: 'employee advance', amount: fmt(buckets.employee_advance) },
      { bucket: 'employee payout', amount: fmt(buckets.employee_payout) },
      { bucket: 'legacy payroll expense', amount: fmt(buckets.legacy_payroll_expense) },
      { bucket: 'non-expense cash-out', amount: fmt(buckets.non_expense_cash_out) },
      { bucket: 'unknown / unclassified', amount: fmt(buckets.unknown) },
    ]);

    section('Suspicious employee-named income categories (active map TxnKind=revenue)');
    const suspicious = await pool.request().query(`
      SELECT
        c.ExpINID,
        c.CatName,
        c.ExpINType,
        m.TxnKind,
        m.EmpID AS mappedEmpId,
        e.EmpName
      FROM dbo.TblExpCatEmpMap m
      INNER JOIN dbo.TblExpINCat c ON c.ExpINID = m.ExpINID
      LEFT JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
      WHERE m.IsActive = 1 AND m.TxnKind = N'revenue'
      ORDER BY c.CatName
    `);

    if (suspicious.recordset.length === 0) {
      console.log('  (none)');
    } else {
      console.table(
        suspicious.recordset.map((row: Record<string, unknown>) => {
          const audit = classifyCategoryForFinancialAudit({
            expInId: Number(row.ExpINID),
            categoryName: String(row.CatName ?? ''),
            expInType: row.ExpINType != null ? String(row.ExpINType) : null,
            txnKind: row.TxnKind != null ? String(row.TxnKind) : null,
            mappedEmpId: row.mappedEmpId != null ? Number(row.mappedEmpId) : null,
          });
          return {
            ExpINID: row.ExpINID,
            CatName: row.CatName,
            ExpINType: row.ExpINType,
            mappedEmpId: row.mappedEmpId,
            EmpName: row.EmpName,
            guess: audit.classificationGuess,
            realRevenue: audit.countsAsRealRevenue ? 'YES' : 'NO',
          };
        }),
      );
    }

    section('Category registry audit (employee-related names)');
    const categories = await pool.request().query(`
      SELECT
        c.ExpINID,
        c.CatName,
        c.ExpINType,
        m.TxnKind,
        m.EmpID AS mappedEmpId,
        e.EmpName
      FROM dbo.TblExpINCat c
      LEFT JOIN dbo.TblExpCatEmpMap m ON m.ExpINID = c.ExpINID AND m.IsActive = 1
      LEFT JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
      WHERE c.CatName LIKE N'%سلف%'
         OR c.CatName LIKE N'%موظف%'
         OR c.CatName LIKE N'%يوميات%'
         OR c.CatName LIKE N'%مرتب%'
         OR c.CatName LIKE N'%تمويل%'
         OR c.CatName LIKE N'%مستحق%'
         OR c.CatName LIKE N'%رد%'
         OR m.TxnKind IS NOT NULL
      ORDER BY c.CatName, m.TxnKind
    `);

    console.table(
      categories.recordset.map((row: Record<string, unknown>) => {
        const audit = classifyCategoryForFinancialAudit({
          expInId: Number(row.ExpINID),
          categoryName: String(row.CatName ?? ''),
          expInType: row.ExpINType != null ? String(row.ExpINType) : null,
          txnKind: row.TxnKind != null ? String(row.TxnKind) : null,
          mappedEmpId: row.mappedEmpId != null ? Number(row.mappedEmpId) : null,
        });
        return {
          ExpINID: row.ExpINID,
          CatName: row.CatName,
          ExpINType: row.ExpINType,
          TxnKind: row.TxnKind ?? '—',
          mappedEmpId: row.mappedEmpId ?? '—',
          EmpName: row.EmpName ?? '—',
          guess: audit.classificationGuess,
          ledgerRelated: audit.isEmployeeLedgerRelated ? 'YES' : 'NO',
          realRevenue: audit.countsAsRealRevenue ? 'YES' : 'NO',
          operatingExpense: audit.countsAsOperatingExpense ? 'YES' : 'NO',
        };
      }),
    );

    section('Legacy payroll mirror candidates (month)');
    const legacy = await pool.request()
      .input('startDate', sql.Date, startDate)
      .input('endDate', sql.Date, endDate)
      .query(`
        SELECT TOP 20
          cm.ID, cm.invDate, cm.invType, cm.inOut, cm.GrandTolal AS amount,
          cat.CatName, cm.EmpID,
          cm.IsPayrollDeduction, cm.IsEmployeePayrollIncome
        FROM dbo.TblCashMove cm
        LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
        WHERE cm.invDate >= @startDate AND cm.invDate <= @endDate
          AND (ISNULL(cm.IsPayrollDeduction,0)=1 OR ISNULL(cm.IsEmployeePayrollIncome,0)=1)
        ORDER BY cm.invDate DESC, cm.ID DESC
      `);
    if (legacy.recordset.length === 0) {
      console.log('  (none in month)');
    } else {
      console.table(legacy.recordset);
    }

    console.log('\n✅ Audit complete (read-only). See docs/financial-reports-audit-phase5a.md');
  } finally {
    await pool.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
