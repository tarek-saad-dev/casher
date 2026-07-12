# Financial Classification — Authenticated Endpoint QA

Manual browser QA + optional cookie script for Phase 5B classified report APIs.

Service-level QA (`node scripts/qa-financial-classification-enabled.js --month=2026-07`) is authoritative for numbers. This guide verifies live HTTP payloads after login.

## Prerequisites

1. Env flag (`.env` / `.env.local`):

```env
FINANCIAL_REPORT_CLASSIFICATION_ENABLED=true
```

2. **Restart Next.js** after changing the flag (env is read at process start).

3. Start the app (example):

```bash
npm run dev
# QA scripts default to http://localhost:5500 — override with QA_BASE_URL or --baseUrl=
```

4. Log in through the browser UI so session cookies are set (`pos_session`).

5. Open DevTools → **Network** tab before loading each report page.

## Optional script (AUTH_COOKIE)

```bash
# Without cookie → SKIPPED (not FAIL)
node scripts/qa-financial-classification-endpoints.js --year=2026 --month=7

# With browser session cookie (copy from DevTools → Application → Cookies)
AUTH_COOKIE="pos_session=YOUR_VALUE" node scripts/qa-financial-classification-endpoints.js --year=2026 --month=7
```

Writes: `docs/financial-classification-endpoint-qa-YYYY-MM.md`

## Pages to open (logged in)

| Page | API to inspect in Network |
|------|---------------------------|
| `/admin/reports/partners` | `/api/admin/reports/partners?year=2026&month=7` |
| `/reports/monthly` | `/api/reports/monthly?year=2026&month=7` |
| `/reports/expenses/monthly` | `/api/reports/expenses/monthly?year=2026&month=7` |
| `/income-review/all-revenue` | `/api/incomes?fromDate=2026-07-01&toDate=2026-07-31` |
| `/treasury/daily` | `/api/treasury/daily-summary?dateFrom=...&dateTo=...` |

### How to inspect

1. Open the page while logged in.
2. In Network, find the matching API request (status should be **200**, not 401/403/500).
3. Open **Response** / **Preview** JSON and check the fields below.

Unauthenticated `fetch` from scripts returns **401** — that is expected; mark **SKIPPED**, not FAIL.

## Per-endpoint checklist

### 1. `/api/reports/monthly?year=2026&month=7`

- [ ] HTTP 200
- [ ] `classificationEnabled === true`
- [ ] Legacy fields still present: `totalRevenue`, `totalExpenses`, `netProfit`
- [ ] `classifiedTotals` object present
- [ ] `classifiedTotals.cleanNetProfit` present (number)
- [ ] `legacyTotals` present when flag on (optional but expected from Phase 5B)

### 2. `/api/admin/reports/partners?year=2026&month=7`

- [ ] HTTP 200
- [ ] `classificationEnabled === true`
- [ ] Legacy `summary` still present (`totalRevenue`, `operatingNet`, …)
- [ ] `classifiedTotals` present
- [ ] `classifiedTotals.cleanNetProfit` present
- [ ] `classifiedPartnerSplit.cleanNetProfit` present and used for partner distribution UI
- [ ] `classifiedPartnerSplit.legacyOperatingNet` present for transition comparison

### 3. `/api/reports/expenses/monthly?year=2026&month=7`

- [ ] HTTP 200
- [ ] `classificationEnabled === true`
- [ ] Legacy `summary`, `categoryBreakdown`, `dailyTrend`, `transactions` present
- [ ] `classifiedTotals` present
- [ ] At least one `transactions[]` row has `reportClassification` when flag is on
- [ ] Each `reportClassification` has `bucket` / `label` (additive only)

### 4. `/api/incomes?fromDate=2026-07-01&toDate=2026-07-31`

- [ ] HTTP 200
- [ ] `classificationEnabled === true`
- [ ] Legacy `summary`, `items`, `byCategory` still present
- [ ] `classifiedTotals` present (income-focused buckets)
- [ ] Non-revenue rows may show `items[].reportClassification` with treasury-style label semantics in UI

### 5. `/api/treasury/daily-summary?dateFrom=2026-07-01&dateTo=2026-07-31`

- [ ] HTTP 200
- [ ] `classificationEnabled === true`
- [ ] Legacy `summary` (`totalInflow`, `totalOutflow`, `grandNet`) still present
- [ ] `classifiedTotals` present (cashflow still shows full cash in/out via totals)
- [ ] No 500 errors when date filters are applied

## Expected July 2026 ballpark (service QA)

| Metric | Approx |
|--------|--------|
| legacyNet | ~30,852 |
| partners cleanNetProfit | ~34,142.07 |
| payrollExpenseFromLedger | ~23,707.93 |
| legacyEmployeeIncomeMirror | ~7,460 (WARN — review only; do not delete rows) |

## Pass / fail for this guide

| Outcome | Meaning |
|---------|---------|
| **PASS** | All five endpoints 200 + `classificationEnabled` + expected classified fields |
| **WARN** | Classification OK but row labels missing / mixed results |
| **SKIPPED** | No AUTH_COOKIE or 401 — complete manual browser QA |
| **FAIL** | 500, missing `classifiedTotals` while flag is true, or legacy fields removed |

## Related

- Service QA: `node scripts/qa-financial-classification-enabled.js --month=2026-07`
- Legacy mirror review: `node scripts/audit-legacy-employee-income-mirrors.js --month=2026-07`
- Flag helper: `src/lib/accounting/financialReportFlags.ts`

## Auth automation note

No shared login helper for scripts. Use browser cookies via `AUTH_COOKIE` or Network tab manual checks. Do not treat 401 as a classification failure.
