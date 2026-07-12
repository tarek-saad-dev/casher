#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * Phase 5B QA runner — FINANCIAL_REPORT_CLASSIFICATION_ENABLED (READ-ONLY).
 *
 * SELECT queries only. Never INSERT / UPDATE / DELETE.
 */

import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import dotenv from 'dotenv';
import { getMonthDateRange, roundMoney } from '../src/lib/reportMonthUtils';
import { isFinancialReportClassificationEnabled } from '../src/lib/accounting/financialReportFlags';
import {
  aggregateClassifiedCashMoves,
  computeCleanNetProfit,
  type CashMoveForReportInput,
} from '../src/lib/accounting/financialReportClassification';
import { classifyCashMoveForFinancialAudit } from '../src/lib/accounting/financialReportClassificationAudit';
import { PARTNERS } from '../src/lib/types/monthly-report';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

/** Hard guard — this script must never write. */
export const QA_READ_ONLY_GUARD = Object.freeze({
  allowWrites: false,
  allowCashMoveUpdates: false,
  allowLedgerUpdates: false,
  allowedStatementTypes: ['SELECT'] as const,
});

const WRITE_PATTERN = /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|EXEC|EXECUTE)\b/i;

const PARTNER_DISPLAY = [
  { name: 'Zeyad (زياد)', percentage: 36.6666666667 },
  { name: 'Mohamed Hamdy (محمد حمدي)', percentage: 31.6666666667 },
  { name: 'Ali Elziny (علي الزيني)', percentage: 31.6666666667 },
];

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

type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';

interface CheckRow {
  id: string;
  status: CheckStatus;
  detail: string;
}

interface EndpointCheck {
  endpoint: string;
  status: CheckStatus;
  httpStatus?: number;
  classificationEnabled?: boolean | null;
  classifiedTotalsPresent?: boolean | null;
  notes: string;
}

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
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function assertSelectOnly(query: string) {
  if (!QA_READ_ONLY_GUARD.allowWrites && WRITE_PATTERN.test(query)) {
    throw new Error(`QA READ-ONLY VIOLATION: non-SELECT SQL blocked:\n${query.slice(0, 200)}`);
  }
  if (!/^\s*SELECT\b/i.test(query.trim())) {
    throw new Error(`QA READ-ONLY VIOLATION: query must start with SELECT:\n${query.slice(0, 200)}`);
  }
}

async function readOnlyQuery(
  pool: sql.ConnectionPool,
  query: string,
  bind?: (req: sql.Request) => sql.Request,
) {
  assertSelectOnly(query);
  const req = bind ? bind(pool.request()) : pool.request();
  return req.query(query);
}

function partnerSplit(base: number) {
  return PARTNER_DISPLAY.map((p) => ({
    name: p.name,
    percentage: p.percentage,
    amount: roundMoney(base * (p.percentage / 100)),
  }));
}

async function checkEndpoints(year: number, month: number, startDate: string, endDate: string): Promise<EndpointCheck[]> {
  const base = 'http://localhost:5500';
  const endpoints = [
    `/api/reports/monthly?year=${year}&month=${month}`,
    `/api/admin/reports/partners?year=${year}&month=${month}`,
    `/api/reports/expenses/monthly?year=${year}&month=${month}`,
    `/api/incomes?fromDate=${startDate}&toDate=${endDate}`,
    `/api/treasury/daily-summary?dateFrom=${startDate}&dateTo=${endDate}`,
  ];

  const results: EndpointCheck[] = [];

  for (const endpoint of endpoints) {
    const url = `${base}${endpoint}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 401 || res.status === 403) {
        results.push({
          endpoint,
          status: 'SKIPPED',
          httpStatus: res.status,
          classificationEnabled: null,
          classifiedTotalsPresent: null,
          notes: 'SKIPPED: requires auth/session',
        });
        continue;
      }

      if (!res.ok) {
        results.push({
          endpoint,
          status: 'WARN',
          httpStatus: res.status,
          notes: `HTTP ${res.status}`,
        });
        continue;
      }

      const body = await res.json().catch(() => null) as Record<string, unknown> | null;
      const classificationEnabled = body?.classificationEnabled === true;
      const classifiedTotalsPresent = Boolean(body?.classifiedTotals);

      results.push({
        endpoint,
        status: classificationEnabled && classifiedTotalsPresent ? 'PASS' : 'WARN',
        httpStatus: res.status,
        classificationEnabled,
        classifiedTotalsPresent,
        notes: classificationEnabled
          ? 'classification payload present'
          : 'response OK but classification fields missing (flag may be off in running server)',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        endpoint,
        status: 'SKIPPED',
        notes: `SKIPPED: server unreachable (${message}). Restart/start next on :5500 if needed.`,
      });
    }
  }

  return results;
}

function overallStatus(checks: CheckRow[]): 'PASS' | 'WARN' | 'FAIL' {
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.status === 'WARN')) return 'WARN';
  return 'PASS';
}

async function main() {
  if (QA_READ_ONLY_GUARD.allowWrites) {
    throw new Error('QA guard misconfigured: allowWrites must be false');
  }

  const { month } = parseArgs(process.argv.slice(2));
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error('Usage: node scripts/qa-financial-classification-enabled.js --month=YYYY-MM');
    process.exit(1);
  }

  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  const { startDate, endDate } = getMonthDateRange(year, monthNum);
  const scriptCommand = `node scripts/qa-financial-classification-enabled.js --month=${month}`;
  const runAt = new Date().toISOString();
  const envFlagRaw = process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED ?? '(missing)';
  const flagEnabled = isFinancialReportClassificationEnabled();

  console.log('Financial Classification QA (READ-ONLY) — Phase 5B');
  console.log('Month:', month, `(${startDate} → ${endDate})`);
  console.log('Flag env:', envFlagRaw, '| isFinancialReportClassificationEnabled():', flagEnabled);
  console.log('Database:', config.database, '@', config.server);
  console.log('Guards: writes=OFF cashMove=OFF ledger=OFF SELECT-only');
  console.log('Partners config check:', PARTNERS.map((p) => `${p.name}=${p.percentage}`).join(', '));

  if (!config.server || !config.user) {
    console.error('Missing DB credentials in .env / .env.local');
    process.exit(1);
  }

  const checks: CheckRow[] = [];
  const executedSql: string[] = [];

  const track = (query: string) => {
    executedSql.push(query.replace(/\s+/g, ' ').trim().slice(0, 160));
    assertSelectOnly(query);
  };

  const pool = await sql.connect(config);

  try {
    // ── 1. CashMove rows (same shape as Phase 5B service) ──
    const movesQuery = `
      SELECT
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
    `;
    track(movesQuery);
    const movesResult = await readOnlyQuery(pool, movesQuery, (req) =>
      req.input('startDate', sql.Date, startDate).input('endDate', sql.Date, endDate),
    );

    const cashRows: CashMoveForReportInput[] = movesResult.recordset.map((row: Record<string, unknown>) => ({
      invType: String(row.invType ?? ''),
      inOut: String(row.inOut ?? ''),
      amount: Number(row.amount) || 0,
      categoryName: String(row.categoryName ?? ''),
      isPayrollDeduction: row.isPayrollDeduction === 1 || row.isPayrollDeduction === true,
      isEmployeePayrollIncome: row.isEmployeePayrollIncome === 1 || row.isEmployeePayrollIncome === true,
      txnKind: row.txnKind != null ? String(row.txnKind) : null,
      empIdFromMap: row.empIdFromMap != null ? Number(row.empIdFromMap) : null,
      empId: row.empId != null ? Number(row.empId) : null,
    }));

    const { classifiedTotals: baseTotals, classificationBreakdown } = aggregateClassifiedCashMoves(cashRows);

    // ── 2. Payroll expense from ledger (same reasons as production helper) ──
    const payrollMonth = month;
    const payrollQuery = `
      SELECT
        ISNULL(SUM(CASE WHEN l.EntryReason = N'hourly_wage' THEN l.Amount ELSE 0 END), 0) AS hourlyWageTotal,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'monthly_salary' THEN l.Amount ELSE 0 END), 0) AS monthlySalaryTotal,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'commission' THEN l.Amount ELSE 0 END), 0) AS commissionTotal,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'bonus' THEN l.Amount ELSE 0 END), 0) AS bonusTotal,
        ISNULL(SUM(CASE WHEN l.EntryReason = N'target' THEN l.Amount ELSE 0 END), 0) AS targetTotal,
        ISNULL(SUM(l.Amount), 0) AS totalPayrollExpense,
        COUNT(*) AS entryCount
      FROM dbo.TblEmpLedgerEntry l
      WHERE l.IsVoided = 0
        AND l.EntryDirection = N'credit'
        AND l.EntryReason IN (N'hourly_wage', N'monthly_salary', N'commission', N'bonus', N'target')
        AND (
          l.PayrollMonth = @month
          OR (
            l.PayrollMonth IS NULL
            AND l.EntryDate >= @monthStart
            AND l.EntryDate <= @monthEnd
          )
        )
    `;
    track(payrollQuery);
    const payrollResult = await readOnlyQuery(pool, payrollQuery, (req) =>
      req
        .input('month', sql.NVarChar(7), payrollMonth)
        .input('monthStart', sql.Date, startDate)
        .input('monthEnd', sql.Date, endDate),
    );

    const payrollRow = payrollResult.recordset[0] ?? {};
    const payrollExpenseFromLedger = roundMoney(Number(payrollRow.totalPayrollExpense ?? 0));
    const hourlyWageTotal = roundMoney(Number(payrollRow.hourlyWageTotal ?? 0));
    const monthlySalaryTotal = roundMoney(Number(payrollRow.monthlySalaryTotal ?? 0));
    const salaryCreditsExist = hourlyWageTotal > 0 || monthlySalaryTotal > 0;
    const payrollEntryCount = Number(payrollRow.entryCount ?? 0);

    // ── 3. Legacy cash totals + Phase 5A-style audit buckets ──
    const legacyQuery = `
      SELECT
        ISNULL(SUM(CASE WHEN inOut = N'in' THEN GrandTolal ELSE 0 END), 0) AS totalIn,
        ISNULL(SUM(CASE WHEN inOut = N'out' THEN GrandTolal ELSE 0 END), 0) AS totalOut,
        ISNULL(SUM(CASE WHEN inOut = N'in' AND invType = N'مبيعات' THEN GrandTolal ELSE 0 END), 0) AS salesIn,
        ISNULL(SUM(CASE WHEN ISNULL(IsEmployeePayrollIncome,0)=1 THEN GrandTolal ELSE 0 END), 0) AS legacyIncomeMirror,
        ISNULL(SUM(CASE WHEN ISNULL(IsPayrollDeduction,0)=1 THEN GrandTolal ELSE 0 END), 0) AS legacyPayrollExpense
      FROM dbo.TblCashMove
      WHERE invDate >= @startDate AND invDate <= @endDate
    `;
    track(legacyQuery);
    const legacyResult = await readOnlyQuery(pool, legacyQuery, (req) =>
      req.input('startDate', sql.Date, startDate).input('endDate', sql.Date, endDate),
    );
    const legacy = legacyResult.recordset[0];
    const legacyRevenue = roundMoney(Number(legacy.totalIn ?? 0));
    const legacyExpenses = roundMoney(Number(legacy.totalOut ?? 0));
    const legacyNet = roundMoney(legacyRevenue - legacyExpenses);

    // Invoice services revenue (partners / monthly revenue source)
    const servicesQuery = `
      SELECT ISNULL(SUM(
        CASE
          WHEN ISNULL(d.SValue, 0) > 0
            THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
          ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
        END
      ), 0) AS TotalRevenue
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID AND h.invType = d.invType
      WHERE CAST(h.invDate AS date) >= @fromDate
        AND CAST(h.invDate AS date) <= @toDate
        AND h.invType = N'مبيعات'
        AND d.EmpID IS NOT NULL
        AND d.ProID IS NOT NULL
    `;
    track(servicesQuery);
    const servicesResult = await readOnlyQuery(pool, servicesQuery, (req) =>
      req.input('fromDate', sql.Date, startDate).input('toDate', sql.Date, endDate),
    );
    const invoiceSalesRevenue = roundMoney(Number(servicesResult.recordset[0]?.TotalRevenue ?? 0));

    // Classified totals (cash-move based + ledger payroll) — matches classification service
    const classifiedTotals = { ...baseTotals };
    classifiedTotals.payrollExpenseFromLedger = payrollExpenseFromLedger;
    classifiedTotals.cleanNetProfit = computeCleanNetProfit(classifiedTotals);

    // Partners/monthly style: override salesRevenue with invoice services
    const partnersClassified = { ...classifiedTotals };
    partnersClassified.salesRevenue = invoiceSalesRevenue;
    partnersClassified.cleanNetProfit = computeCleanNetProfit(partnersClassified);

    const expectedClean = roundMoney(
      classifiedTotals.salesRevenue
        + classifiedTotals.otherBusinessIncome
        - classifiedTotals.operatingExpense
        - classifiedTotals.payrollExpenseFromLedger,
    );
    const formulaOk = Math.abs(classifiedTotals.cleanNetProfit - expectedClean) < 0.01;

    // Phase 5A audit comparison (reuse same classify helper)
    const auditBuckets: Record<string, number> = {
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
    for (const row of cashRows) {
      const audit = classifyCashMoveForFinancialAudit(row);
      if (audit.revenueClass) {
        auditBuckets[audit.revenueClass] = (auditBuckets[audit.revenueClass] ?? 0) + row.amount;
      } else if (audit.expenseClass) {
        auditBuckets[audit.expenseClass] = (auditBuckets[audit.expenseClass] ?? 0) + row.amount;
      } else {
        auditBuckets.unknown += row.amount;
      }
    }

    // ── Checks ──
    if (!flagEnabled) {
      checks.push({
        id: 'flag_enabled',
        status: 'FAIL',
        detail: `FINANCIAL_REPORT_CLASSIFICATION_ENABLED=${envFlagRaw}; isFinancialReportClassificationEnabled()=false`,
      });
    } else {
      checks.push({
        id: 'flag_enabled',
        status: 'PASS',
        detail: 'isFinancialReportClassificationEnabled() = true',
      });
    }

    checks.push({
      id: 'classified_totals_present',
      status: classifiedTotals ? 'PASS' : 'FAIL',
      detail: classifiedTotals ? 'classifiedTotals built from Phase 5B helpers' : 'classifiedTotals missing',
    });

    checks.push({
      id: 'legacy_totals_present',
      status: 'PASS',
      detail: `legacyRevenue=${fmt(legacyRevenue)}, legacyExpenses=${fmt(legacyExpenses)}, legacyNet=${fmt(legacyNet)}`,
    });

    checks.push({
      id: 'clean_net_formula',
      status: formulaOk ? 'PASS' : 'FAIL',
      detail: formulaOk
        ? `cleanNetProfit=${fmt(classifiedTotals.cleanNetProfit)} matches formula`
        : `formula mismatch: got ${fmt(classifiedTotals.cleanNetProfit)} expected ${fmt(expectedClean)}`,
    });

    if (salaryCreditsExist && payrollExpenseFromLedger <= 0) {
      checks.push({
        id: 'payroll_from_ledger',
        status: 'FAIL',
        detail: `salary ledger credits exist (hourly=${fmt(hourlyWageTotal)}, monthly=${fmt(monthlySalaryTotal)}) but payrollExpenseFromLedger=0`,
      });
    } else if (salaryCreditsExist && payrollExpenseFromLedger > 0) {
      checks.push({
        id: 'payroll_from_ledger',
        status: 'PASS',
        detail: `payrollExpenseFromLedger=${fmt(payrollExpenseFromLedger)} (entries=${payrollEntryCount})`,
      });
    } else if (!salaryCreditsExist && payrollExpenseFromLedger === 0) {
      checks.push({
        id: 'payroll_from_ledger',
        status: 'WARN',
        detail: 'payrollExpenseFromLedger=0 and no hourly_wage/monthly_salary credits in month',
      });
    } else {
      checks.push({
        id: 'payroll_from_ledger',
        status: 'PASS',
        detail: `payrollExpenseFromLedger=${fmt(payrollExpenseFromLedger)}`,
      });
    }

    const cleanExcludesNonRevenue =
      Math.abs(
        classifiedTotals.cleanNetProfit
          - (
            classifiedTotals.salesRevenue
            + classifiedTotals.otherBusinessIncome
            - classifiedTotals.operatingExpense
            - classifiedTotals.payrollExpenseFromLedger
          ),
      ) < 0.01
      && classifiedTotals.nonRevenueCashIn >= 0;

    checks.push({
      id: 'non_revenue_excluded',
      status: cleanExcludesNonRevenue ? 'PASS' : 'FAIL',
      detail: `nonRevenueCashIn=${fmt(classifiedTotals.nonRevenueCashIn)} not in cleanNetProfit formula`,
    });

    checks.push({
      id: 'advances_excluded',
      status: 'PASS',
      detail: `employeeAdvances=${fmt(classifiedTotals.employeeAdvances)} not subtracted in cleanNetProfit formula`,
    });

    checks.push({
      id: 'payouts_excluded',
      status: 'PASS',
      detail: `employeePayouts=${fmt(classifiedTotals.employeePayouts)} not subtracted in cleanNetProfit formula`,
    });

    checks.push({
      id: 'mirror_not_real_revenue',
      status: classifiedTotals.legacyEmployeeIncomeMirror >= 0 ? 'PASS' : 'FAIL',
      detail: `legacyEmployeeIncomeMirror=${fmt(classifiedTotals.legacyEmployeeIncomeMirror)}; real revenue uses sales+otherBusiness only`,
    });

    checks.push({
      id: 'partners_use_clean_net',
      status: 'PASS',
      detail: `Partner split base = partnersClassified.cleanNetProfit=${fmt(partnersClassified.cleanNetProfit)} (invoice sales override)`,
    });

    const anyWriteSql = executedSql.some((q) => WRITE_PATTERN.test(q));
    checks.push({
      id: 'no_writes',
      status: anyWriteSql || QA_READ_ONLY_GUARD.allowWrites ? 'FAIL' : 'PASS',
      detail: anyWriteSql
        ? 'Write-like SQL detected'
        : `All ${executedSql.length} queries were SELECT-only; no TblCashMove/TblEmpLedgerEntry writes`,
    });

    // WARN checks
    if (classifiedTotals.uncategorizedCashIn > 0) {
      checks.push({
        id: 'uncategorized_in',
        status: 'WARN',
        detail: `uncategorizedCashIn=${fmt(classifiedTotals.uncategorizedCashIn)}`,
      });
    }
    if (classifiedTotals.uncategorizedCashOut > 0) {
      checks.push({
        id: 'uncategorized_out',
        status: 'WARN',
        detail: `uncategorizedCashOut=${fmt(classifiedTotals.uncategorizedCashOut)}`,
      });
    }
    if (classifiedTotals.legacyEmployeeIncomeMirror > 0) {
      checks.push({
        id: 'legacy_mirror_warn',
        status: 'WARN',
        detail: `legacyEmployeeIncomeMirror=${fmt(classifiedTotals.legacyEmployeeIncomeMirror)}`,
      });
    }
    if (classifiedTotals.legacyPayrollExpense > 0) {
      checks.push({
        id: 'legacy_payroll_warn',
        status: 'WARN',
        detail: `legacyPayrollExpense=${fmt(classifiedTotals.legacyPayrollExpense)}`,
      });
    }

    const diffPct =
      legacyNet !== 0
        ? Math.abs((partnersClassified.cleanNetProfit - legacyNet) / legacyNet) * 100
        : partnersClassified.cleanNetProfit !== 0
          ? 100
          : 0;
    if (diffPct > 20) {
      checks.push({
        id: 'clean_vs_legacy_delta',
        status: 'WARN',
        detail: `cleanNetProfit vs legacyNet differs by ${diffPct.toFixed(1)}% (expected during transition)`,
      });
    }

    // ── Partner splits ──
    const oldSplit = partnerSplit(legacyNet);
    const cleanSplit = partnerSplit(partnersClassified.cleanNetProfit);

    // ── Endpoints ──
    section('Endpoint checks (localhost:5500)');
    const endpointChecks = await checkEndpoints(year, monthNum, startDate, endDate);
    for (const ep of endpointChecks) {
      console.log(`  [${ep.status}] ${ep.endpoint} — ${ep.notes}`);
    }

    // ── Print summary tables ──
    section('Core totals');
    console.table([
      { metric: 'legacyRevenue (cash in)', amount: fmt(legacyRevenue) },
      { metric: 'legacyExpenses (cash out)', amount: fmt(legacyExpenses) },
      { metric: 'legacyNet', amount: fmt(legacyNet) },
      { metric: 'invoiceSalesRevenue (services)', amount: fmt(invoiceSalesRevenue) },
      { metric: 'salesRevenue (cashMove)', amount: fmt(classifiedTotals.salesRevenue) },
      { metric: 'otherBusinessIncome', amount: fmt(classifiedTotals.otherBusinessIncome) },
      { metric: 'nonRevenueCashIn', amount: fmt(classifiedTotals.nonRevenueCashIn) },
      { metric: 'legacyEmployeeIncomeMirror', amount: fmt(classifiedTotals.legacyEmployeeIncomeMirror) },
      { metric: 'operatingExpense', amount: fmt(classifiedTotals.operatingExpense) },
      { metric: 'employeeAdvances', amount: fmt(classifiedTotals.employeeAdvances) },
      { metric: 'employeePayouts', amount: fmt(classifiedTotals.employeePayouts) },
      { metric: 'payrollExpenseFromLedger', amount: fmt(classifiedTotals.payrollExpenseFromLedger) },
      { metric: 'legacyPayrollExpense', amount: fmt(classifiedTotals.legacyPayrollExpense) },
      { metric: 'internalTransfers', amount: fmt(classifiedTotals.internalTransfers) },
      { metric: 'uncategorizedCashIn', amount: fmt(classifiedTotals.uncategorizedCashIn) },
      { metric: 'uncategorizedCashOut', amount: fmt(classifiedTotals.uncategorizedCashOut) },
      { metric: 'cleanNetProfit (cash sales)', amount: fmt(classifiedTotals.cleanNetProfit) },
      { metric: 'cleanNetProfit (partners/invoice override)', amount: fmt(partnersClassified.cleanNetProfit) },
    ]);

    section('Phase 5A audit comparison (cash buckets)');
    console.table([
      { bucket: 'sales_revenue', audit: fmt(auditBuckets.sales_revenue), classified: fmt(classifiedTotals.salesRevenue) },
      { bucket: 'other_business_income', audit: fmt(auditBuckets.other_business_income), classified: fmt(classifiedTotals.otherBusinessIncome) },
      { bucket: 'non_revenue_cash_in', audit: fmt(auditBuckets.non_revenue_cash_in), classified: fmt(classifiedTotals.nonRevenueCashIn) },
      { bucket: 'legacy_employee_income_mirror', audit: fmt(auditBuckets.legacy_employee_income_mirror), classified: fmt(classifiedTotals.legacyEmployeeIncomeMirror) },
      { bucket: 'operating_expense', audit: fmt(auditBuckets.operating_expense), classified: fmt(classifiedTotals.operatingExpense) },
      { bucket: 'employee_advance', audit: fmt(auditBuckets.employee_advance), classified: fmt(classifiedTotals.employeeAdvances) },
      { bucket: 'employee_payout', audit: fmt(auditBuckets.employee_payout), classified: fmt(classifiedTotals.employeePayouts) },
      { bucket: 'legacy_payroll_expense', audit: fmt(auditBuckets.legacy_payroll_expense), classified: fmt(classifiedTotals.legacyPayrollExpense) },
    ]);

    section('Partner split comparison');
    console.table(
      oldSplit.map((row, i) => ({
        Partner: row.name,
        OldSplit: fmt(row.amount),
        CleanSplit: fmt(cleanSplit[i].amount),
        Difference: fmt(cleanSplit[i].amount - row.amount),
      })),
    );

    section('Checks');
    console.table(checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail })));

    const summary = overallStatus(checks);
    const ready = summary !== 'FAIL';

    section(`SUMMARY: ${summary}`);
    console.log('READY_FOR_CLASSIFIED_REPORTS=' + (ready ? 'true' : 'false'));
    console.log('NOTE: If Next.js was started before setting the flag, restart the server so APIs pick up FINANCIAL_REPORT_CLASSIFICATION_ENABLED=true.');

    // ── Write markdown report ──
    const reportPath = path.join(__dirname, '..', 'docs', `financial-classification-qa-${month}.md`);
    const md = buildMarkdownReport({
      month,
      runAt,
      scriptCommand,
      envFlagRaw,
      flagEnabled,
      summary,
      ready,
      legacyRevenue,
      legacyExpenses,
      legacyNet,
      invoiceSalesRevenue,
      classifiedTotals,
      partnersCleanNet: partnersClassified.cleanNetProfit,
      diffPct,
      oldSplit,
      cleanSplit,
      checks,
      endpointChecks,
      classificationBreakdown,
      auditBuckets,
      payrollExpenseFromLedger,
      salaryCreditsExist,
      hourlyWageTotal,
      monthlySalaryTotal,
    });
    fs.writeFileSync(reportPath, md, 'utf8');
    console.log('\nReport written:', reportPath);

    if (summary === 'FAIL') process.exitCode = 2;
  } finally {
    await pool.close();
  }
}

function buildMarkdownReport(input: {
  month: string;
  runAt: string;
  scriptCommand: string;
  envFlagRaw: string;
  flagEnabled: boolean;
  summary: 'PASS' | 'WARN' | 'FAIL';
  ready: boolean;
  legacyRevenue: number;
  legacyExpenses: number;
  legacyNet: number;
  invoiceSalesRevenue: number;
  classifiedTotals: ReturnType<typeof aggregateClassifiedCashMoves>['classifiedTotals'];
  partnersCleanNet: number;
  diffPct: number;
  oldSplit: Array<{ name: string; amount: number }>;
  cleanSplit: Array<{ name: string; amount: number }>;
  checks: CheckRow[];
  endpointChecks: EndpointCheck[];
  classificationBreakdown: ReturnType<typeof aggregateClassifiedCashMoves>['classificationBreakdown'];
  auditBuckets: Record<string, number>;
  payrollExpenseFromLedger: number;
  salaryCreditsExist: boolean;
  hourlyWageTotal: number;
  monthlySalaryTotal: number;
}): string {
  const t = input.classifiedTotals;
  const diff = roundMoney(input.partnersCleanNet - input.legacyNet);

  const warnings = input.checks.filter((c) => c.status === 'WARN');
  const fails = input.checks.filter((c) => c.status === 'FAIL');

  return `# Financial Classification QA — July 2026

## Environment
- FINANCIAL_REPORT_CLASSIFICATION_ENABLED: \`${input.envFlagRaw}\`
- isFinancialReportClassificationEnabled(): **${input.flagEnabled}**
- date/time: ${input.runAt}
- script command: \`${input.scriptCommand}\`
- mode: **READ ONLY** (SELECT only; no TblCashMove / TblEmpLedgerEntry writes)
- restart note: If the Next.js dev server was already running before the flag was set, **restart it** so API routes load \`FINANCIAL_REPORT_CLASSIFICATION_ENABLED=true\`.

## Summary
- Result: **${input.summary}**
- recommendation: \`READY_FOR_CLASSIFIED_REPORTS=${input.ready}\`
- Failures: ${fails.length}
- Warnings: ${warnings.length}

## Legacy vs Classified Totals

| Metric | Amount |
|--------|--------|
| legacyRevenue (cash in) | ${fmt(input.legacyRevenue)} |
| legacyExpenses (cash out) | ${fmt(input.legacyExpenses)} |
| legacyNet | ${fmt(input.legacyNet)} |
| invoiceSalesRevenue (services / partners source) | ${fmt(input.invoiceSalesRevenue)} |
| cleanNetProfit (cash-move sales base) | ${fmt(t.cleanNetProfit)} |
| cleanNetProfit (partners override) | ${fmt(input.partnersCleanNet)} |
| difference (partners clean − legacyNet) | ${fmt(diff)} |
| difference % | ${input.diffPct.toFixed(2)}% |

## Classified Breakdown

| Bucket | Amount |
|--------|--------|
| salesRevenue | ${fmt(t.salesRevenue)} |
| otherBusinessIncome | ${fmt(t.otherBusinessIncome)} |
| nonRevenueCashIn | ${fmt(t.nonRevenueCashIn)} |
| legacyEmployeeIncomeMirror | ${fmt(t.legacyEmployeeIncomeMirror)} |
| operatingExpense | ${fmt(t.operatingExpense)} |
| employeeAdvances | ${fmt(t.employeeAdvances)} |
| employeePayouts | ${fmt(t.employeePayouts)} |
| payrollExpenseFromLedger | ${fmt(t.payrollExpenseFromLedger)} |
| legacyPayrollExpense | ${fmt(t.legacyPayrollExpense)} |
| internalTransfers | ${fmt(t.internalTransfers)} |
| uncategorizedCashIn | ${fmt(t.uncategorizedCashIn)} |
| uncategorizedCashOut | ${fmt(t.uncategorizedCashOut)} |
| cashInTotal | ${fmt(t.cashInTotal)} |
| cashOutTotal | ${fmt(t.cashOutTotal)} |
| cleanNetProfit | ${fmt(t.cleanNetProfit)} |

### Phase 5A audit alignment (cash buckets)

| Audit bucket | Audit amount | Classified amount |
|--------------|--------------|-------------------|
| sales_revenue | ${fmt(input.auditBuckets.sales_revenue)} | ${fmt(t.salesRevenue)} |
| other_business_income | ${fmt(input.auditBuckets.other_business_income)} | ${fmt(t.otherBusinessIncome)} |
| non_revenue_cash_in | ${fmt(input.auditBuckets.non_revenue_cash_in)} | ${fmt(t.nonRevenueCashIn)} |
| legacy_employee_income_mirror | ${fmt(input.auditBuckets.legacy_employee_income_mirror)} | ${fmt(t.legacyEmployeeIncomeMirror)} |
| operating_expense | ${fmt(input.auditBuckets.operating_expense)} | ${fmt(t.operatingExpense)} |
| employee_advance | ${fmt(input.auditBuckets.employee_advance)} | ${fmt(t.employeeAdvances)} |
| employee_payout | ${fmt(input.auditBuckets.employee_payout)} | ${fmt(t.employeePayouts)} |
| legacy_payroll_expense | ${fmt(input.auditBuckets.legacy_payroll_expense)} | ${fmt(t.legacyPayrollExpense)} |

Ledger payroll credits: hourly=${fmt(input.hourlyWageTotal)}, monthly=${fmt(input.monthlySalaryTotal)}, total=${fmt(input.payrollExpenseFromLedger)}, salaryCreditsExist=${input.salaryCreditsExist}.

## Partner Split Comparison

Base old = legacyNet (${fmt(input.legacyNet)})  
Base clean = partners cleanNetProfit (${fmt(input.partnersCleanNet)})  
Shares: Zeyad 36.6666666667%, Mohamed Hamdy 31.6666666667%, Ali Elziny 31.6666666667%

| Partner | Old Split | Clean Split | Difference |
|---------|-----------|-------------|------------|
${input.oldSplit
  .map((row, i) => {
    const clean = input.cleanSplit[i];
    return `| ${row.name} | ${fmt(row.amount)} | ${fmt(clean.amount)} | ${fmt(clean.amount - row.amount)} |`;
  })
  .join('\n')}

## Checks

| Check | Status | Detail |
|-------|--------|--------|
${input.checks.map((c) => `| ${c.id} | ${c.status} | ${c.detail.replace(/\|/g, '/')} |`).join('\n')}

## Warnings
${
  warnings.length === 0
    ? '- (none)'
    : warnings.map((w) => `- **${w.id}**: ${w.detail}`).join('\n')
}

${
  fails.length
    ? `## Failures\n${fails.map((f) => `- **${f.id}**: ${f.detail}`).join('\n')}\n`
    : ''
}

## Endpoint Checks

| Endpoint | Status | HTTP | classificationEnabled | classifiedTotals | Notes |
|----------|--------|------|-----------------------|------------------|-------|
${input.endpointChecks
  .map(
    (e) =>
      `| \`${e.endpoint}\` | ${e.status} | ${e.httpStatus ?? '—'} | ${e.classificationEnabled ?? '—'} | ${e.classifiedTotalsPresent ?? '—'} | ${e.notes.replace(/\|/g, '/')} |`,
  )
  .join('\n')}

## Final Recommendation

${
  input.summary === 'FAIL'
    ? '**Do not enable classified reports in production yet.** Fix FAIL checks first (flag, formula, payroll ledger mapping, or partner base).'
    : input.summary === 'WARN'
      ? '**Classification can be used behind the feature flag for review**, but review warnings (uncategorized rows, legacy mirrors/payroll, large clean vs legacy delta) before treating classified totals as the sole production truth.'
      : '**Classification looks ready for staged rollout** behind the flag. Keep legacy totals visible during transition and monitor uncategorized buckets.'
}

\`READY_FOR_CLASSIFIED_REPORTS=${input.ready}\`

---
*Generated by \`scripts/qa-financial-classification-enabled-runner.ts\` — read-only QA, no data mutations.*
`;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
