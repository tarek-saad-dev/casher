#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * Phase 5B.3 endpoint QA runner (READ-ONLY HTTP GET).
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  buildEndpointUrls,
  evaluateFinancialClassificationEndpointResponse,
  summarizeEndpointQaResults,
  type EndpointQaResult,
} from '../src/lib/accounting/financialClassificationEndpointQa';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

function parseArgs(argv: string[]) {
  let year = 2026;
  let month = 7;
  let baseUrl = process.env.QA_BASE_URL || 'http://localhost:5500';
  for (const arg of argv) {
    if (arg.startsWith('--year=')) year = parseInt(arg.slice('--year='.length), 10);
    if (arg.startsWith('--month=')) month = parseInt(arg.slice('--month='.length), 10);
    if (arg.startsWith('--baseUrl=')) baseUrl = arg.slice('--baseUrl='.length);
  }
  return { year, month, baseUrl };
}

function fmtStatus(results: EndpointQaResult[]) {
  return summarizeEndpointQaResults(results);
}

async function fetchEndpoint(
  url: string,
  cookie: string | null,
): Promise<{ httpStatus: number | null; body: Record<string, unknown> | null; errorMessage: string | null }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timer);
    const body = await res.json().catch(() => null);
    return {
      httpStatus: res.status,
      body: body && typeof body === 'object' ? (body as Record<string, unknown>) : null,
      errorMessage: null,
    };
  } catch (err) {
    return {
      httpStatus: null,
      body: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const { year, month, baseUrl } = parseArgs(process.argv.slice(2));
  const cookie = process.env.AUTH_COOKIE?.trim() || null;
  const flag = process.env.FINANCIAL_REPORT_CLASSIFICATION_ENABLED ?? '(missing)';
  const runAt = new Date().toISOString();
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  console.log('Financial Classification Endpoint QA — Phase 5B.3');
  console.log('Period:', monthKey);
  console.log('Base URL:', baseUrl);
  console.log('FINANCIAL_REPORT_CLASSIFICATION_ENABLED:', flag);
  console.log('AUTH_COOKIE:', cookie ? 'provided' : 'missing → auth endpoints will SKIP');
  console.log('Restart reminder: restart Next.js after changing the classification flag.');

  const targets = buildEndpointUrls({ baseUrl, year, month });
  const results: EndpointQaResult[] = [];

  for (const target of targets) {
    if (!cookie) {
      results.push(
        evaluateFinancialClassificationEndpointResponse({
          expectation: target.expectation,
          endpoint: target.endpoint,
          httpStatus: 401,
          body: null,
        }),
      );
      continue;
    }

    const { httpStatus, body, errorMessage } = await fetchEndpoint(target.url, cookie);
    results.push(
      evaluateFinancialClassificationEndpointResponse({
        expectation: target.expectation,
        endpoint: target.endpoint,
        httpStatus,
        body,
        errorMessage,
      }),
    );
  }

  console.log('\nEndpoint results');
  console.table(
    results.map((r) => ({
      endpoint: r.endpoint,
      status: r.status,
      http: r.httpStatus,
      classificationEnabled: r.classificationEnabled,
      classifiedTotals: r.classifiedTotalsPresent,
      notes: r.notes,
    })),
  );

  const summary = fmtStatus(results);
  console.log('\nSUMMARY:', summary);
  if (!cookie) {
    console.log('Manual QA: see docs/financial-classification-endpoint-qa.md');
    console.log('With cookie: AUTH_COOKIE="pos_session=..." node scripts/qa-financial-classification-endpoints.js --year=2026 --month=7');
  }

  const reportPath = path.join(
    __dirname,
    '..',
    'docs',
    `financial-classification-endpoint-qa-${monthKey}.md`,
  );

  const md = `# Financial Classification Endpoint QA — ${monthKey}

## Environment
- FINANCIAL_REPORT_CLASSIFICATION_ENABLED: \`${flag}\`
- date/time: ${runAt}
- baseUrl: \`${baseUrl}\`
- AUTH_COOKIE: ${cookie ? 'provided' : '**missing**'}
- server restart reminder: **Restart Next.js** after setting/changing the classification flag so APIs load \`classificationEnabled=true\`.

## Summary
- Result: **${summary}**
- Authenticated run: ${cookie ? 'yes' : 'no (SKIPPED auth)'}

## Endpoint table

| Endpoint | Status | HTTP | classificationEnabled | classifiedTotals | Notes |
|----------|--------|------|-----------------------|------------------|-------|
${results
  .map(
    (r) =>
      `| \`${r.endpoint}\` | ${r.status} | ${r.httpStatus ?? '—'} | ${r.classificationEnabled ?? '—'} | ${r.classifiedTotalsPresent ?? '—'} | ${r.notes.replace(/\|/g, '/')} |`,
  )
  .join('\n')}

## Manual QA checklist

See \`docs/financial-classification-endpoint-qa.md\`.

Pages to open while logged in:
- [ ] \`/admin/reports/partners?year=${year}&month=${month}\`
- [ ] \`/reports/monthly\` (select ${monthKey})
- [ ] \`/reports/expenses/monthly\`
- [ ] \`/income-review/all-revenue\` (dates ${monthKey}-01 → end of month)
- [ ] \`/treasury/daily\` (date range for ${monthKey})

For each Network response confirm:
- [ ] HTTP 200
- [ ] \`classificationEnabled === true\`
- [ ] legacy totals still present
- [ ] \`classifiedTotals\` present
- [ ] monthly/partners include \`cleanNetProfit\`
- [ ] no HTTP 500

## Final endpoint QA result

**${summary}**

${
  summary === 'SKIPPED'
    ? 'No AUTH_COOKIE / unauthenticated. Service-level QA remains authoritative for numbers. Complete manual browser QA after login before full cutover.'
    : summary === 'PASS'
      ? 'Authenticated endpoints returned classification payloads as expected.'
      : summary === 'WARN'
        ? 'Partial success — review notes (row classification missing or mixed SKIPPED/PASS).'
        : 'Failures detected — inspect notes before enabling classification permanently.'
}

---
*Phase 5B.3 — read-only HTTP GET QA. No data mutations.*
`;

  fs.writeFileSync(reportPath, md, 'utf8');
  console.log('Report written:', reportPath);

  // SKIPPED without cookie is success exit; FAIL is non-zero
  if (summary === 'FAIL') process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
