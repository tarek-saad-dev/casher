import { describe, it, expect } from 'vitest';
import {
  buildInvoiceSearchRankInputs,
  computeInvoiceSearchRankScore,
  normalizePhoneSearch,
  tokenizeInvoiceSearchQuery,
} from '@/lib/invoiceSearch';
import {
  buildRecentInvoicesCacheKey,
  buildRecentInvoicesWhereClause,
  countActiveRecentInvoiceFilters,
  filtersToQueryParams,
  hasActiveRecentInvoiceFilters,
  parseRecentInvoicesSearchParams,
} from '@/lib/recentInvoicesQuery';
import { DEFAULT_RECENT_INVOICES_FILTERS } from '@/lib/recentInvoices.types';

describe('invoiceSearch', () => {
  it('normalizes Egyptian phone numbers for search', () => {
    expect(normalizePhoneSearch('+20 112 456 7890')).toBe('01124567890');
    expect(normalizePhoneSearch('٠١١٢')).toBe('0112');
  });

  it('ranks exact invoice number above partial customer matches', () => {
    const inputs = buildInvoiceSearchRankInputs('6466');
    const exact = computeInvoiceSearchRankScore(inputs, {
      invId: 6466,
      phone: null,
      clientName: 'Test',
    });
    const partial = computeInvoiceSearchRankScore(inputs, {
      invId: 1234,
      phone: null,
      clientName: '6466 customer',
    });
    expect(exact).toBeLessThan(partial);
  });

  it('ranks exact phone above customer-name contains matches', () => {
    const inputs = buildInvoiceSearchRankInputs('01124567890');
    const phone = computeInvoiceSearchRankScore(inputs, {
      invId: 100,
      phone: '01124567890',
      clientName: 'Ali',
    });
    const name = computeInvoiceSearchRankScore(inputs, {
      invId: 101,
      phone: '01000000000',
      clientName: '01124567890',
    });
    expect(phone).toBeLessThan(name);
  });

  it('tokenizes multi-word invoice search queries', () => {
    expect(tokenizeInvoiceSearchQuery('حلاقة 6466')).toEqual(['حلاقة', '6466']);
  });
});

describe('recentInvoicesQuery filters', () => {
  it('builds payment filter that includes split-payment rows', () => {
    const parsed = parseRecentInvoicesSearchParams(
      new URLSearchParams('paymentMethodIds=1,3'),
    );
    const where = buildRecentInvoicesWhereClause(parsed);
    expect(where).toContain('TblinvServPayment');
    expect(where).toContain('PaymentMethodID IN (1,3)');
  });

  it('builds employee filter using service detail rows', () => {
    const parsed = parseRecentInvoicesSearchParams(new URLSearchParams('employeeIds=25,30'));
    const where = buildRecentInvoicesWhereClause(parsed);
    expect(where).toContain('TblinvServDetail');
    expect(where).toContain('EmpID IN (25,30)');
  });

  it('combines payment, employee, and date filters with AND semantics', () => {
    const parsed = parseRecentInvoicesSearchParams(
      new URLSearchParams(
        'paymentMethodIds=1&employeeIds=25&dateFrom=2026-07-01&dateTo=2026-07-02',
      ),
    );
    const where = buildRecentInvoicesWhereClause(parsed);
    expect(where).toContain('TblinvServPayment');
    expect(where).toContain('TblinvServDetail');
    expect(where).toContain('CAST(h.invDate AS DATE) >= @dateFrom');
    expect(where).toContain('CAST(h.invDate AS DATE) <= @dateTo');
  });

  it('changes cache key when filters change to reset pagination', () => {
    const base = filtersToQueryParams(DEFAULT_RECENT_INVOICES_FILTERS);
    const filtered = filtersToQueryParams({
      ...DEFAULT_RECENT_INVOICES_FILTERS,
      selectedPaymentMethodIds: [1],
    });
    expect(buildRecentInvoicesCacheKey(base)).not.toBe(buildRecentInvoicesCacheKey(filtered));
  });

  it('clears active filter state back to defaults', () => {
    const active = {
      ...DEFAULT_RECENT_INVOICES_FILTERS,
      invoiceSearchQuery: '6466',
      selectedPaymentMethodIds: [1],
      selectedEmployeeIds: [25],
      selectedDatePreset: 'last7' as const,
      selectedStatus: 'complete' as const,
    };
    expect(hasActiveRecentInvoiceFilters(active)).toBe(true);
    expect(countActiveRecentInvoiceFilters(active)).toBeGreaterThan(0);
    expect(hasActiveRecentInvoiceFilters(DEFAULT_RECENT_INVOICES_FILTERS)).toBe(false);
  });

  it('parses search query into SQL patterns for service and employee fields', () => {
    const parsed = parseRecentInvoicesSearchParams(new URLSearchParams('q=حلاقة'));
    expect(parsed.searchTokens.length).toBeGreaterThan(0);
    const where = buildRecentInvoicesWhereClause(parsed);
    expect(where).toContain('pS.ProName');
    expect(where).toContain('eS.EmpName');
  });
});

describe('recent invoice list merging', () => {
  it('prevents duplicate invoices when appending pages', () => {
    const page1 = [{ InvID: 1 }, { InvID: 2 }];
    const page2 = [{ InvID: 2 }, { InvID: 3 }];
    const seen = new Set(page1.map((item) => item.InvID));
    const merged = [...page1];
    for (const item of page2) {
      if (!seen.has(item.InvID)) {
        seen.add(item.InvID);
        merged.push(item);
      }
    }
    expect(merged).toHaveLength(3);
  });
});
