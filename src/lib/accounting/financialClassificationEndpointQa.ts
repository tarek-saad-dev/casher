/**
 * Phase 5B.3 — Pure endpoint response checks for financial classification QA.
 * No network I/O here; used by scripts and unit tests.
 */

export type EndpointQaStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';

export interface EndpointQaExpectation {
  id: string;
  path: string;
  requiresCleanNetProfit?: boolean;
  requiresRowClassification?: boolean;
  legacyFields: string[];
}

export interface EndpointQaResult {
  id: string;
  endpoint: string;
  status: EndpointQaStatus;
  httpStatus: number | null;
  classificationEnabled: boolean | null;
  classifiedTotalsPresent: boolean | null;
  cleanNetProfitPresent: boolean | null;
  reportClassificationPresent: boolean | null;
  notes: string;
}

export const FINANCIAL_CLASSIFICATION_ENDPOINT_EXPECTATIONS: EndpointQaExpectation[] = [
  {
    id: 'monthly',
    path: '/api/reports/monthly',
    requiresCleanNetProfit: true,
    legacyFields: ['totalRevenue', 'totalExpenses', 'netProfit'],
  },
  {
    id: 'partners',
    path: '/api/admin/reports/partners',
    requiresCleanNetProfit: true,
    legacyFields: ['summary'],
  },
  {
    id: 'expenses_monthly',
    path: '/api/reports/expenses/monthly',
    requiresRowClassification: true,
    legacyFields: ['summary', 'transactions'],
  },
  {
    id: 'incomes',
    path: '/api/incomes',
    requiresRowClassification: true,
    legacyFields: ['summary', 'items'],
  },
  {
    id: 'treasury_daily',
    path: '/api/treasury/daily-summary',
    legacyFields: ['summary'],
  },
];

function hasLegacyFields(body: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => body[field] !== undefined && body[field] !== null);
}

function hasReportClassificationOnRows(body: Record<string, unknown>): boolean {
  const transactions = body.transactions;
  if (Array.isArray(transactions) && transactions.some((row) => row && typeof row === 'object' && 'reportClassification' in row)) {
    return true;
  }
  const items = body.items;
  if (Array.isArray(items) && items.some((row) => row && typeof row === 'object' && 'reportClassification' in row)) {
    return true;
  }
  return false;
}

export function evaluateFinancialClassificationEndpointResponse(params: {
  expectation: EndpointQaExpectation;
  endpoint: string;
  httpStatus: number | null;
  body: Record<string, unknown> | null;
  errorMessage?: string | null;
}): EndpointQaResult {
  const { expectation, endpoint, httpStatus, body, errorMessage } = params;

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      id: expectation.id,
      endpoint,
      status: 'SKIPPED',
      httpStatus,
      classificationEnabled: null,
      classifiedTotalsPresent: null,
      cleanNetProfitPresent: null,
      reportClassificationPresent: null,
      notes: 'SKIPPED: requires authenticated session',
    };
  }

  if (httpStatus == null) {
    return {
      id: expectation.id,
      endpoint,
      status: 'SKIPPED',
      httpStatus: null,
      classificationEnabled: null,
      classifiedTotalsPresent: null,
      cleanNetProfitPresent: null,
      reportClassificationPresent: null,
      notes: errorMessage
        ? `SKIPPED: server unreachable (${errorMessage})`
        : 'SKIPPED: server unreachable',
    };
  }

  if (httpStatus >= 500) {
    return {
      id: expectation.id,
      endpoint,
      status: 'FAIL',
      httpStatus,
      classificationEnabled: null,
      classifiedTotalsPresent: null,
      cleanNetProfitPresent: null,
      reportClassificationPresent: null,
      notes: `HTTP ${httpStatus} server error`,
    };
  }

  if (httpStatus !== 200 || !body) {
    return {
      id: expectation.id,
      endpoint,
      status: 'WARN',
      httpStatus,
      classificationEnabled: null,
      classifiedTotalsPresent: null,
      cleanNetProfitPresent: null,
      reportClassificationPresent: null,
      notes: `Unexpected HTTP ${httpStatus}`,
    };
  }

  const classificationEnabled = body.classificationEnabled === true;
  const classifiedTotals = body.classifiedTotals;
  const classifiedTotalsPresent =
    classifiedTotals != null && typeof classifiedTotals === 'object';
  const cleanNet =
    classifiedTotals && typeof classifiedTotals === 'object'
      ? (classifiedTotals as Record<string, unknown>).cleanNetProfit
      : undefined;
  const partnerClean =
    body.classifiedPartnerSplit && typeof body.classifiedPartnerSplit === 'object'
      ? (body.classifiedPartnerSplit as Record<string, unknown>).cleanNetProfit
      : undefined;
  const cleanNetProfitPresent =
    typeof cleanNet === 'number' || typeof partnerClean === 'number';
  const reportClassificationPresent = hasReportClassificationOnRows(body);
  const legacyOk = hasLegacyFields(body, expectation.legacyFields);

  if (!classificationEnabled) {
    return {
      id: expectation.id,
      endpoint,
      status: 'FAIL',
      httpStatus,
      classificationEnabled: false,
      classifiedTotalsPresent,
      cleanNetProfitPresent,
      reportClassificationPresent,
      notes: 'classificationEnabled is not true (flag off in running server or payload missing)',
    };
  }

  if (!classifiedTotalsPresent) {
    return {
      id: expectation.id,
      endpoint,
      status: 'FAIL',
      httpStatus,
      classificationEnabled: true,
      classifiedTotalsPresent: false,
      cleanNetProfitPresent,
      reportClassificationPresent,
      notes: 'classifiedTotals missing while classificationEnabled=true',
    };
  }

  if (!legacyOk) {
    return {
      id: expectation.id,
      endpoint,
      status: 'FAIL',
      httpStatus,
      classificationEnabled: true,
      classifiedTotalsPresent: true,
      cleanNetProfitPresent,
      reportClassificationPresent,
      notes: `Legacy fields missing: ${expectation.legacyFields.join(', ')}`,
    };
  }

  if (expectation.requiresCleanNetProfit && !cleanNetProfitPresent) {
    return {
      id: expectation.id,
      endpoint,
      status: 'FAIL',
      httpStatus,
      classificationEnabled: true,
      classifiedTotalsPresent: true,
      cleanNetProfitPresent: false,
      reportClassificationPresent,
      notes: 'cleanNetProfit missing on classifiedTotals / classifiedPartnerSplit',
    };
  }

  if (expectation.requiresRowClassification && !reportClassificationPresent) {
    return {
      id: expectation.id,
      endpoint,
      status: 'WARN',
      httpStatus,
      classificationEnabled: true,
      classifiedTotalsPresent: true,
      cleanNetProfitPresent,
      reportClassificationPresent: false,
      notes: 'classifiedTotals OK but no reportClassification on rows (empty month or flag path)',
    };
  }

  return {
    id: expectation.id,
    endpoint,
    status: 'PASS',
    httpStatus,
    classificationEnabled: true,
    classifiedTotalsPresent: true,
    cleanNetProfitPresent,
    reportClassificationPresent,
    notes: 'classification payload OK; legacy fields preserved',
  };
}

export function summarizeEndpointQaResults(results: EndpointQaResult[]): EndpointQaStatus {
  if (results.some((r) => r.status === 'FAIL')) return 'FAIL';
  if (results.every((r) => r.status === 'SKIPPED')) return 'SKIPPED';
  if (results.some((r) => r.status === 'WARN')) return 'WARN';
  if (results.some((r) => r.status === 'SKIPPED') && results.some((r) => r.status === 'PASS')) {
    return 'WARN';
  }
  return 'PASS';
}

export function buildEndpointUrls(params: {
  baseUrl: string;
  year: number;
  month: number;
}): Array<{ expectation: EndpointQaExpectation; endpoint: string; url: string }> {
  const { baseUrl, year, month } = params;
  const mm = String(month).padStart(2, '0');
  const startDate = `${year}-${mm}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  const pathBuilders: Record<string, string> = {
    monthly: `/api/reports/monthly?year=${year}&month=${month}`,
    partners: `/api/admin/reports/partners?year=${year}&month=${month}`,
    expenses_monthly: `/api/reports/expenses/monthly?year=${year}&month=${month}`,
    incomes: `/api/incomes?fromDate=${startDate}&toDate=${endDate}`,
    treasury_daily: `/api/treasury/daily-summary?dateFrom=${startDate}&dateTo=${endDate}`,
  };

  return FINANCIAL_CLASSIFICATION_ENDPOINT_EXPECTATIONS.map((expectation) => {
    const endpoint = pathBuilders[expectation.id];
    return {
      expectation,
      endpoint,
      url: `${baseUrl.replace(/\/$/, '')}${endpoint}`,
    };
  });
}
