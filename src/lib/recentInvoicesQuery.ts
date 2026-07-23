import {
  RECENT_INVOICES_DEFAULT_LIMIT,
  RECENT_INVOICES_MAX_LIMIT,
  RECENT_INVOICES_MAX_QUERY_LENGTH,
  type RecentInvoiceDatePreset,
  type RecentInvoicesFilterState,
  type RecentInvoicesQueryParams,
  type RecentInvoiceStatusFilter,
} from '@/lib/recentInvoices.types';
import {
  buildInvoiceSearchLikePattern,
  buildInvoiceSearchRankInputs,
  meetsMinimumTextSearchLength,
  normalizePhoneSearch,
  tokenizeInvoiceSearchQuery,
} from '@/lib/invoiceSearch';
import { normalizeSearchText } from '@/lib/serviceSearch';

export interface ParsedRecentInvoicesQuery extends RecentInvoicesQueryParams {
  searchRankInputs: ReturnType<typeof buildInvoiceSearchRankInputs>;
  searchTokens: string[];
  searchLikePatterns: string[];
  phonePattern: string | null;
}

function parseIdList(value: string | null): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => parseInt(part.trim(), 10))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function parseAmount(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

function parseDate(value: string | null): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

function parseStatus(value: string | null): RecentInvoiceStatusFilter | undefined {
  if (value === 'complete' || value === 'incomplete') return value;
  return undefined;
}

function parseLimit(value: string | null): number {
  const parsed = value ? parseInt(value, 10) : RECENT_INVOICES_DEFAULT_LIMIT;
  if (!Number.isInteger(parsed) || parsed <= 0) return RECENT_INVOICES_DEFAULT_LIMIT;
  return Math.min(parsed, RECENT_INVOICES_MAX_LIMIT);
}

function parseCursor(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function resolveDatePresetRange(
  preset: RecentInvoiceDatePreset | null,
  customFrom: string,
  customTo: string,
  now = new Date(),
): { dateFrom?: string; dateTo?: string } {
  const toIso = (date: Date) => date.toISOString().slice(0, 10);

  if (!preset) {
    return {
      dateFrom: customFrom || undefined,
      dateTo: customTo || undefined,
    };
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case 'today':
      return { dateFrom: toIso(today), dateTo: toIso(today) };
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { dateFrom: toIso(yesterday), dateTo: toIso(yesterday) };
    }
    case 'last7': {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { dateFrom: toIso(from), dateTo: toIso(today) };
    }
    case 'thisMonth': {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      return { dateFrom: toIso(from), dateTo: toIso(today) };
    }
    case 'custom':
      return {
        dateFrom: customFrom || undefined,
        dateTo: customTo || undefined,
      };
    default:
      return {};
  }
}

export function filtersToQueryParams(
  filters: RecentInvoicesFilterState,
): RecentInvoicesQueryParams {
  const { dateFrom, dateTo } = resolveDatePresetRange(
    filters.selectedDatePreset,
    filters.customDateFrom,
    filters.customDateTo,
  );

  return {
    q: filters.invoiceSearchQuery.trim() || undefined,
    paymentMethodIds: filters.selectedPaymentMethodIds.length
      ? filters.selectedPaymentMethodIds
      : undefined,
    employeeIds: filters.selectedEmployeeIds.length ? filters.selectedEmployeeIds : undefined,
    dateFrom,
    dateTo,
    minAmount: filters.minAmount ? parseAmount(filters.minAmount) : undefined,
    maxAmount: filters.maxAmount ? parseAmount(filters.maxAmount) : undefined,
    status: filters.selectedStatus ?? undefined,
    limit: RECENT_INVOICES_DEFAULT_LIMIT,
  };
}

export function countActiveRecentInvoiceFilters(filters: RecentInvoicesFilterState): number {
  let count = 0;
  if (filters.invoiceSearchQuery.trim()) count += 1;
  if (filters.selectedPaymentMethodIds.length) count += 1;
  if (filters.selectedEmployeeIds.length) count += 1;
  if (filters.selectedDatePreset || filters.customDateFrom || filters.customDateTo) count += 1;
  if (filters.minAmount || filters.maxAmount) count += 1;
  if (filters.selectedStatus) count += 1;
  return count;
}

export function hasActiveRecentInvoiceFilters(filters: RecentInvoicesFilterState): boolean {
  return countActiveRecentInvoiceFilters(filters) > 0;
}

export function parseRecentInvoicesSearchParams(
  searchParams: URLSearchParams,
): ParsedRecentInvoicesQuery {
  const rawQuery = (searchParams.get('q') ?? '').trim().slice(0, RECENT_INVOICES_MAX_QUERY_LENGTH);
  const q = rawQuery || undefined;

  if (q && !meetsMinimumTextSearchLength(q)) {
    return {
      q: undefined,
      paymentMethodIds: parseIdList(searchParams.get('paymentMethodIds')),
      employeeIds: parseIdList(searchParams.get('employeeIds')),
      dateFrom: parseDate(searchParams.get('dateFrom')),
      dateTo: parseDate(searchParams.get('dateTo')),
      minAmount: parseAmount(searchParams.get('minAmount')),
      maxAmount: parseAmount(searchParams.get('maxAmount')),
      status: parseStatus(searchParams.get('status')),
      limit: parseLimit(searchParams.get('limit')),
      cursor: parseCursor(searchParams.get('cursor')),
      searchRankInputs: buildInvoiceSearchRankInputs(''),
      searchTokens: [],
      searchLikePatterns: [],
      phonePattern: null,
    };
  }

  const tokens = q ? tokenizeInvoiceSearchQuery(q) : [];
  const searchLikePatterns = tokens.map(buildInvoiceSearchLikePattern);
  const phonePattern = q ? normalizePhoneSearch(q) : null;

  return {
    q,
    paymentMethodIds: parseIdList(searchParams.get('paymentMethodIds')),
    employeeIds: parseIdList(searchParams.get('employeeIds')),
    dateFrom: parseDate(searchParams.get('dateFrom')),
    dateTo: parseDate(searchParams.get('dateTo')),
    minAmount: parseAmount(searchParams.get('minAmount')),
    maxAmount: parseAmount(searchParams.get('maxAmount')),
    status: parseStatus(searchParams.get('status')),
    limit: parseLimit(searchParams.get('limit')),
    cursor: parseCursor(searchParams.get('cursor')),
    searchRankInputs: buildInvoiceSearchRankInputs(q ?? ''),
    searchTokens: tokens,
    searchLikePatterns,
    phonePattern: phonePattern ? `%${phonePattern.replace(/[%_[\]]/g, '')}%` : null,
  };
}

export function buildRecentInvoicesQueryString(
  params: RecentInvoicesQueryParams,
  cursor?: number | null,
): string {
  const search = new URLSearchParams();

  if (params.q) search.set('q', params.q);
  if (params.paymentMethodIds?.length) {
    search.set('paymentMethodIds', params.paymentMethodIds.join(','));
  }
  if (params.employeeIds?.length) {
    search.set('employeeIds', params.employeeIds.join(','));
  }
  if (params.dateFrom) search.set('dateFrom', params.dateFrom);
  if (params.dateTo) search.set('dateTo', params.dateTo);
  if (params.minAmount !== undefined) search.set('minAmount', String(params.minAmount));
  if (params.maxAmount !== undefined) search.set('maxAmount', String(params.maxAmount));
  if (params.status) search.set('status', params.status);
  search.set('limit', String(params.limit ?? RECENT_INVOICES_DEFAULT_LIMIT));
  if (cursor) search.set('cursor', String(cursor));

  return search.toString();
}

export function buildRecentInvoicesCacheKey(params: RecentInvoicesQueryParams): string {
  return JSON.stringify({
    // PHASE1D: branchId is not sent to the server (the server always filters by the
    // session's validated active branch) — it is included here only so that switching
    // the active branch invalidates the client-side response cache instead of showing
    // another branch's cached invoices.
    branchId: params.branchId ?? null,
    q: params.q ?? '',
    paymentMethodIds: params.paymentMethodIds ?? [],
    employeeIds: params.employeeIds ?? [],
    dateFrom: params.dateFrom ?? '',
    dateTo: params.dateTo ?? '',
    minAmount: params.minAmount ?? null,
    maxAmount: params.maxAmount ?? null,
    status: params.status ?? '',
    limit: params.limit ?? RECENT_INVOICES_DEFAULT_LIMIT,
  });
}

export function normalizeInvoiceSearchField(value: string | null | undefined): string {
  return normalizeSearchText(value ?? '');
}

const INV_TYPE = 'مبيعات';

export function buildRecentInvoicesWhereClause(parsed: ParsedRecentInvoicesQuery): string {
  const conditions = [
    `h.invType = N'${INV_TYPE}'`,
    `ISNULL(h.isActive, 'no') = 'no'`,
  ];

  if (parsed.cursor) {
    conditions.push('h.invID < @cursor');
  }

  if (parsed.dateFrom) {
    conditions.push('CAST(h.invDate AS DATE) >= @dateFrom');
  }
  if (parsed.dateTo) {
    conditions.push('CAST(h.invDate AS DATE) <= @dateTo');
  }

  if (parsed.minAmount !== undefined) {
    conditions.push('ISNULL(h.GrandTotal, 0) >= @minAmount');
  }
  if (parsed.maxAmount !== undefined) {
    conditions.push('ISNULL(h.GrandTotal, 0) <= @maxAmount');
  }

  if (parsed.status === 'complete') {
    conditions.push(
      'ISNULL(h.GrandTotal, 0) <= (ISNULL(h.PayCash, 0) + ISNULL(h.PayVisa, 0))',
    );
  } else if (parsed.status === 'incomplete') {
    conditions.push(
      'ISNULL(h.GrandTotal, 0) > (ISNULL(h.PayCash, 0) + ISNULL(h.PayVisa, 0))',
    );
  }

  if (parsed.paymentMethodIds?.length) {
    const idList = parsed.paymentMethodIds.join(',');
    conditions.push(`(
      h.PaymentMethodID IN (${idList})
      OR EXISTS (
        SELECT 1
        FROM [dbo].[TblinvServPayment] p
        WHERE p.invID = h.invID
          AND p.invType = h.invType
          AND ISNULL(p.PayValue, 0) > 0
          AND p.PaymentMethodID IN (${idList})
      )
    )`);
  }

  if (parsed.employeeIds?.length) {
    const idList = parsed.employeeIds.join(',');
    conditions.push(`EXISTS (
      SELECT 1
      FROM [dbo].[TblinvServDetail] dEmp
      WHERE dEmp.invID = h.invID
        AND dEmp.invType = h.invType
        AND dEmp.EmpID IN (${idList})
    )`);
  }

  if (parsed.searchTokens.length > 0) {
    parsed.searchTokens.forEach((_, index) => {
      conditions.push(`(
        CAST(h.invID AS NVARCHAR(20)) LIKE @searchPattern${index}
        OR ISNULL(c.[Name], N'') LIKE @searchPattern${index}
        OR REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(c.Mobile, N''), N' ', N''), N'-', N''), N'(', N''), N')', N'') LIKE @searchPattern${index}
        OR EXISTS (
          SELECT 1
          FROM [dbo].[TblinvServDetail] dS
          LEFT JOIN [dbo].[TblPro] pS ON dS.ProID = pS.ProID
          LEFT JOIN [dbo].[TblEmp] eS ON dS.EmpID = eS.EmpID
          LEFT JOIN [dbo].[TblPaymentMethods] pmS ON h.PaymentMethodID = pmS.PaymentID
          WHERE dS.invID = h.invID
            AND dS.invType = h.invType
            AND (
              ISNULL(pS.ProName, N'') LIKE @searchPattern${index}
              OR ISNULL(pS.ProNameAr, N'') LIKE @searchPattern${index}
              OR ISNULL(eS.EmpName, N'') LIKE @searchPattern${index}
              OR ISNULL(pmS.PaymentMethod, N'') LIKE @searchPattern${index}
            )
        )
      )`);
    });
  } else if (parsed.phonePattern) {
    conditions.push(`(
      REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(c.Mobile, N''), N' ', N''), N'-', N''), N'(', N''), N')', N'') LIKE @phonePattern
      OR CAST(h.invID AS NVARCHAR(20)) LIKE @phonePattern
    )`);
  }

  return conditions.join(' AND ');
}
