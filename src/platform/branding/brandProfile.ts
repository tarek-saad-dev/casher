/**
 * DRVO-017 tenant brand profile — pure types, validation and print helpers.
 * Safe to import from client components (no server-only / DB imports).
 */

export interface TenantBrandProfile {
  tenantId: string;
  displayName: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  receiptFooter: string | null;
  timezone: string;
  publicBookingOrigins: string[];
  revision: number;
  updatedAt: string | null;
}

/** Fields a tenant admin or platform operator may edit. */
export interface TenantBrandProfileInput {
  displayName: string;
  logoUrl?: string | null;
  phone?: string | null;
  address?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  receiptFooter?: string | null;
  timezone: string;
  publicBookingOrigins?: string[];
}

export class BrandProfileValidationError extends Error {
  readonly code = 'BRAND_PROFILE_INVALID' as const;
  readonly status = 400;
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'BrandProfileValidationError';
  }
}

export const BRAND_LIMITS = {
  displayName: 128,
  logoUrl: 512,
  phone: 40,
  address: 256,
  receiptFooter: 256,
  timezone: 64,
  origins: 10,
  originsJson: 2000,
} as const;

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const PHONE_RE = /^[0-9+()\-\s]{3,40}$/;

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new BrandProfileValidationError(field, `${field} must be text`);
  const v = value.trim();
  if (!v) return null;
  if (v.length > max) throw new BrandProfileValidationError(field, `${field} is longer than ${max} characters`);
  return v;
}

function requiredText(value: unknown, field: string, max: number): string {
  const v = optionalText(value, field, max);
  if (!v) throw new BrandProfileValidationError(field, `${field} is required`);
  return v;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Logo must be a same-origin path or an https URL (no data:/javascript: URLs). */
export function normalizeLogoUrl(value: unknown): string | null {
  const v = optionalText(value, 'logoUrl', BRAND_LIMITS.logoUrl);
  if (!v) return null;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new BrandProfileValidationError('logoUrl', 'logoUrl must be a /path or an https:// URL');
  }
  if (url.protocol !== 'https:') {
    throw new BrandProfileValidationError('logoUrl', 'logoUrl must be a /path or an https:// URL');
  }
  return url.toString();
}

export function normalizeColor(value: unknown, field: string): string | null {
  const v = optionalText(value, field, 7);
  if (!v) return null;
  if (!HEX_COLOR_RE.test(v)) throw new BrandProfileValidationError(field, `${field} must be #RRGGBB`);
  return v.toUpperCase();
}

/** Origins are scheme://host[:port] only; https required except for localhost. */
export function normalizeOrigins(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BrandProfileValidationError('publicBookingOrigins', 'publicBookingOrigins must be a list of origins');
  }
  const out: string[] = [];
  for (const raw of value as string[]) {
    const v = raw.trim();
    if (!v) continue;
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      throw new BrandProfileValidationError('publicBookingOrigins', `Invalid origin: ${v}`);
    }
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
      throw new BrandProfileValidationError('publicBookingOrigins', `Origin must use https: ${v}`);
    }
    if ((url.pathname && url.pathname !== '/') || url.search || url.hash || url.username) {
      throw new BrandProfileValidationError('publicBookingOrigins', `Origin must not contain a path: ${v}`);
    }
    if (!out.includes(url.origin)) out.push(url.origin);
  }
  if (out.length > BRAND_LIMITS.origins) {
    throw new BrandProfileValidationError('publicBookingOrigins', `At most ${BRAND_LIMITS.origins} origins`);
  }
  if (JSON.stringify(out).length > BRAND_LIMITS.originsJson) {
    throw new BrandProfileValidationError('publicBookingOrigins', 'publicBookingOrigins is too long');
  }
  return out;
}

/** Validate and normalize an editable brand payload. Throws BrandProfileValidationError. */
export function validateBrandProfileInput(body: Record<string, unknown>): TenantBrandProfileInput {
  const timezone = requiredText(body.timezone, 'timezone', BRAND_LIMITS.timezone);
  if (!isValidTimezone(timezone)) {
    throw new BrandProfileValidationError('timezone', `Unknown timezone: ${timezone}`);
  }
  const phone = optionalText(body.phone, 'phone', BRAND_LIMITS.phone);
  if (phone && !PHONE_RE.test(phone)) {
    throw new BrandProfileValidationError('phone', 'phone may contain digits, spaces, +, - and parentheses only');
  }
  return {
    displayName: requiredText(body.displayName, 'displayName', BRAND_LIMITS.displayName),
    logoUrl: normalizeLogoUrl(body.logoUrl),
    phone,
    address: optionalText(body.address, 'address', BRAND_LIMITS.address),
    primaryColor: normalizeColor(body.primaryColor, 'primaryColor'),
    accentColor: normalizeColor(body.accentColor, 'accentColor'),
    receiptFooter: optionalText(body.receiptFooter, 'receiptFooter', BRAND_LIMITS.receiptFooter),
    timezone,
    publicBookingOrigins: normalizeOrigins(body.publicBookingOrigins),
  };
}

/** Short wordmark for receipt logo badges: first word of the display name, upper-cased. */
export function brandWordmark(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? '';
  return first.toUpperCase().slice(0, 12);
}

/** Header line used on printed receipts / tickets. */
export function brandPrintTitle(displayName: string): string {
  return displayName.trim().toUpperCase();
}

/** First number of a multi-number phone field ("010… - 035…" → "010…"), for compact headers. */
export function brandPrimaryPhone(phone: string | null | undefined): string | null {
  const first = (phone ?? '').split(/\s+-\s+|[,،/]/)[0]?.trim();
  return first || null;
}

/** Brand fields as printed on receipts, tickets and PDFs. */
export interface PrintBrand {
  /** Display name as entered ("Cut Salon"). */
  name: string;
  /** Upper-case header ("CUT SALON"). */
  title: string;
  /** Short badge text ("CUT"). */
  wordmark: string;
  logoUrl: string | null;
  /** Full phone field (footer contact line). */
  phone: string | null;
  /** First phone number (header line). */
  primaryPhone: string | null;
  address: string | null;
  footer: string | null;
}

export function toPrintBrand(brand: Pick<TenantBrandProfile, 'displayName' | 'logoUrl' | 'phone' | 'address' | 'receiptFooter'> | null): PrintBrand {
  const name = brand?.displayName?.trim() ?? '';
  return {
    name,
    title: brandPrintTitle(name),
    wordmark: brandWordmark(name),
    logoUrl: brand?.logoUrl ?? null,
    phone: brand?.phone ?? null,
    primaryPhone: brandPrimaryPhone(brand?.phone),
    address: brand?.address ?? null,
    footer: brand?.receiptFooter ?? null,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Same as toPrintBrand with every text field HTML-escaped, for string-built print documents. */
export function toPrintBrandHtml(brand: Parameters<typeof toPrintBrand>[0]): PrintBrand {
  const raw = toPrintBrand(brand);
  const e = (v: string | null) => (v == null ? null : escapeHtml(v));
  return {
    name: escapeHtml(raw.name),
    title: escapeHtml(raw.title),
    wordmark: escapeHtml(raw.wordmark),
    logoUrl: e(raw.logoUrl),
    phone: e(raw.phone),
    primaryPhone: e(raw.primaryPhone),
    address: e(raw.address),
    footer: e(raw.footer),
  };
}
