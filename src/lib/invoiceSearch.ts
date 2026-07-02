import { normalizeSearchText } from '@/lib/serviceSearch';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Normalize phone numbers for search matching only. */
export function normalizePhoneSearch(value: string): string {
  if (!value) return '';

  let phone = value.trim();
  phone = phone.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  phone = phone.replace(/[^\d+]/g, '');

  if (phone.startsWith('+20')) {
    phone = `0${phone.slice(3)}`;
  } else if (phone.startsWith('20') && phone.length > 10) {
    phone = `0${phone.slice(2)}`;
  }

  return phone;
}

export function tokenizeInvoiceSearchQuery(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

export function isNumericInvoiceQuery(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length > 0 && /^[\d٠-٩+\s()-]+$/.test(trimmed);
}

export function shouldAllowSingleCharInvoiceSearch(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length === 1 && /^\d$/.test(trimmed);
}

export function meetsMinimumTextSearchLength(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  if (shouldAllowSingleCharInvoiceSearch(trimmed)) return true;
  if (isNumericInvoiceQuery(trimmed)) return trimmed.replace(/\D/g, '').length >= 1;
  return trimmed.length >= 2;
}

export function buildInvoiceSearchLikePattern(token: string): string {
  return `%${token.replace(/[%_[\]]/g, '')}%`;
}

export interface InvoiceSearchRankInputs {
  query: string;
  normalizedQuery: string;
  phoneQuery: string;
  tokens: string[];
}

export function buildInvoiceSearchRankInputs(query: string): InvoiceSearchRankInputs {
  const trimmed = query.trim();
  return {
    query: trimmed,
    normalizedQuery: normalizeSearchText(trimmed),
    phoneQuery: normalizePhoneSearch(trimmed),
    tokens: tokenizeInvoiceSearchQuery(trimmed),
  };
}

/** Higher-level ranking score for SQL ORDER BY (lower = better). */
export function computeInvoiceSearchRankScore(
  inputs: InvoiceSearchRankInputs,
  invoice: {
    invId: number;
    phone: string | null;
    clientName: string | null;
  },
): number {
  if (!inputs.query) return 100;

  const invNo = String(invoice.invId);
  const phone = normalizePhoneSearch(invoice.phone ?? '');
  const name = normalizeSearchText(invoice.clientName ?? '');

  if (invNo === inputs.query || invNo === inputs.normalizedQuery) return 0;
  if (invNo.startsWith(inputs.query) || invNo.startsWith(inputs.normalizedQuery)) return 1;

  if (inputs.phoneQuery) {
    if (phone === inputs.phoneQuery) return 2;
    if (phone.startsWith(inputs.phoneQuery)) return 3;
  }

  if (name && inputs.normalizedQuery) {
    if (name === inputs.normalizedQuery) return 4;
    if (name.startsWith(inputs.normalizedQuery)) return 5;
  }

  if (inputs.tokens.length > 0) return 6;
  return 7;
}
