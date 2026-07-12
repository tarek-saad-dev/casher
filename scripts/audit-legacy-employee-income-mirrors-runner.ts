#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * Phase 5C — Legacy employee income mirror audit runner (SELECT only).
 */

import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import dotenv from 'dotenv';
import { getMonthDateRange } from '../src/lib/reportMonthUtils';
import {
  LEGACY_MIRROR_CANDIDATE_SELECT_SQL,
  LEGACY_MIRROR_REVIEW_READ_ONLY_GUARD,
  buildLegacyEmployeeMirrorReviewFromRows,
  mapDbRowToLegacyMirrorInput,
} from '../src/lib/accounting/legacyEmployeeMirrorReview';

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
  requestTimeout: 120000,
};

function parseArgs(argv: string[]) {
  let month: string | null = null;
  let empId: number | null = null;
  for (const arg of argv) {
    if (arg.startsWith('--month=')) month = arg.slice('--month='.length);
    if (arg.startsWith('--empId=')) empId = parseInt(arg.slice('--empId='.length), 10);
  }
  return { month, empId };
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function section(title: string) {
  console.log('\n' + '═'.repeat(72));
  console.log(title);
  console.log('═'.repeat(72));
}

async function main() {
  if (LEGACY_MIRROR_REVIEW_READ_ONLY_GUARD.allowWrites) {
    throw new Error('Read-only guard misconfigured');
  }

  const { month, empId } = parseArgs(process.argv.slice(2));
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    console.error('Usage: node scripts/audit-legacy-employee-income-mirrors.js --month=YYYY-MM [--empId=N]');
    process.exit(1);
  }

  const [yearStr, monthStr] = month.split('-');
  const { startDate, endDate } = getMonthDateRange(parseInt(yearStr, 10), parseInt(monthStr, 10));

  console.log('Legacy Employee Income Mirror Review (READ-ONLY) — Phase 5C');
  console.log('Month:', month, `(${startDate} → ${endDate})`);
  if (empId) console.log('Emp filter:', empId);
  console.log('Guards: writes=OFF cashMove=OFF ledger=OFF');

  if (!config.server || !config.user) {
    console.error('Missing DB credentials');
    process.exit(1);
  }

  const queryText = `
    ${LEGACY_MIRROR_CANDIDATE_SELECT_SQL}
    ${empId != null && empId > 0 ? 'AND (cm.EmpID = @empId OR map.EmpID = @empId)' : ''}
    ORDER BY cm.invDate DESC, cm.ID DESC
  `;

  if (WRITE_PATTERN.test(queryText) || !/^\s*SELECT\b/i.test(queryText.trim())) {
    throw new Error('READ-ONLY VIOLATION');
  }

  const pool = await sql.connect(config);
  try {
    const req = pool
      .request()
      .input('startDate', sql.Date, startDate)
      .input('endDate', sql.Date, endDate);
    if (empId != null && empId > 0) req.input('empId', sql.Int, empId);

    const result = await req.query(queryText);
    const inputs = result.recordset.map((row: Record<string, unknown>) => mapDbRowToLegacyMirrorInput(row));
    const review = buildLegacyEmployeeMirrorReviewFromRows({ month, rows: inputs });
    const { summary, rows } = review;

    section('Totals');
    console.log('Total legacy mirror amount:', fmt(summary.totalAmount));
    console.log('Row count:', summary.rowCount);
    console.log('Confidence:', summary.confidence);
    console.log('includedInCleanProfit:', review.includedInCleanProfit);
    console.log('historicalRowsUnchanged:', review.historicalRowsUnchanged);

    section('By employee');
    console.table(
      summary.byEmployee.map((r) => ({
        EmpName: r.empName,
        EmpID: r.empId,
        Total: fmt(r.total),
        Count: r.count,
      })),
    );

    section('By category');
    console.table(
      summary.byCategory.map((r) => ({
        Category: r.categoryName,
        CategoryId: r.categoryId,
        Total: fmt(r.total),
        Count: r.count,
      })),
    );

    section('By date');
    console.table(
      summary.byDate.map((r) => ({
        Date: r.date,
        Total: fmt(r.total),
        Count: r.count,
      })),
    );

    section('Top rows');
    console.table(
      rows.slice(0, 25).map((r) => ({
        CashMoveID: r.cashMoveId,
        Date: r.date,
        EmpName: r.resolvedEmpName,
        Category: r.categoryName,
        Amount: fmt(r.amount),
        Payment: r.paymentMethod,
        TxnKind: r.txnKind,
        Confidence: r.confidence,
        Reason: r.reason,
      })),
    );

    console.log('\nConfirmation:');
    console.log('- These rows are excluded from cleanNetProfit (includedInCleanProfit=false)');
    console.log('- Historical rows still exist; this script performed SELECT only');
    console.log('- No TblCashMove / TblEmpLedgerEntry writes');

    const reportPath = path.join(
      __dirname,
      '..',
      'docs',
      `legacy-employee-income-mirror-review-${month}.md`,
    );

    const md = `# Legacy Employee Income Mirror Review — ${month === '2026-07' ? 'July 2026' : month}

## Summary
- total amount: **${fmt(summary.totalAmount)}**
- row count: **${summary.rowCount}**
- employees affected: **${summary.byEmployee.length}**
- categories affected: **${summary.byCategory.length}**
- confidence summary: high=${summary.confidence.high}, medium=${summary.confidence.medium}, low=${summary.confidence.low}
- included in clean profit? **No** (\`includedInCleanProfit=false\`)
- included in legacy cash revenue? **likely yes** (income/in treasury cash-in still counted in legacy cash totals)

## Why this matters

هذه حركات خزنة قديمة مرتبطة بنظام مرايا إيراد الموظفين، وليست إيراد بيع حقيقي. النظام الجديد يعزلها عن صافي الربح النظيف (\`cleanNetProfit\`) عبر bucket \`legacyEmployeeIncomeMirror\`.

## Rows

| CashMoveID | Date | EmpName | Category | Amount | Payment | TxnKind | Confidence | Reason |
|------------|------|---------|----------|--------|---------|---------|------------|--------|
${rows
  .map(
    (r) =>
      `| ${r.cashMoveId} | ${r.date} | ${r.resolvedEmpName} | ${r.categoryName ?? '—'} | ${fmt(r.amount)} | ${r.paymentMethod || '—'} | ${r.txnKind ?? '—'} | ${r.confidence} | ${r.reason.replace(/\|/g, '/')} |`,
  )
  .join('\n')}

## By Employee

| EmpName | Total | Count |
|---------|-------|-------|
${summary.byEmployee.map((r) => `| ${r.empName} | ${fmt(r.total)} | ${r.count} |`).join('\n')}

## By Category

| Category | Total | Count |
|----------|-------|-------|
${summary.byCategory.map((r) => `| ${r.categoryName} | ${fmt(r.total)} | ${r.count} |`).join('\n')}

## Optional UI drilldown proposal (not implemented)

- In \`FinancialClassificationPanel\` / partners / monthly report, add a card/link:
  **مرايا إيرادات موظفين قديمة**
- On click, open a read-only drilldown of these review rows (CashMoveID, employee, category, amount).
- Do **not** void/delete historical rows; show as **Legacy Adjustment**.
- Defer implementation until a dedicated read-only review endpoint is approved.

## Recommendation
- Do not delete historical rows.
- Keep them visible as Legacy Adjustment.
- Exclude from clean profit (already done by classification).
- Optional future phase can add UI drilldown for legacy adjustments.
- Staged flag rollout remains appropriate; do not full cutover solely because of this WARN.

## Guards
- readOnly: true
- historicalRowsUnchanged: true
- writes performed: **none** (SELECT only)

---
*Generated by \`scripts/audit-legacy-employee-income-mirrors-runner.ts\` — Phase 5C QA/Review only.*
`;

    fs.writeFileSync(reportPath, md, 'utf8');
    console.log('\nReport written:', reportPath);
  } finally {
    await pool.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
