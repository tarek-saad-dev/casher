/**
 * Booking Phase 2 — pure public-bookable service eligibility policy.
 * No DB / server-only imports — safe for admin client badges + unit tests.
 */

export const PUBLIC_BOOKING_SERVICE_CONTRACT_VERSION = 'v2';
export const PUBLIC_BOOKING_PRICING_SCOPE = 'global' as const;
export const PUBLIC_BOOKING_CURRENCY = 'EGP';

/** Reasonable public booking duration ceiling (8 hours). */
export const MAX_PUBLIC_BOOKING_DURATION_MINUTES = 480;

/** Public description length cap. */
export const MAX_PUBLIC_DESCRIPTION_CHARS = 500;

export const UNCATEGORIZED_CATEGORY_ID = 'uncategorized';
export const UNCATEGORIZED_CATEGORY_NAME_AR = 'أخرى';
export const UNCATEGORIZED_CATEGORY_NAME_EN = 'Other';

/** Product / retail category name fragments (CatType may be wrong). */
export const PRODUCT_CATEGORY_NAME_PATTERNS = [
  'منتجات',
  'منتج',
  'اكسسوارات',
  'إكسسوارات',
  'اكسيسوارات',
  'إكسيسوارات',
  'عطور',
  'برفانات',
  'براندات',
  'براند',
] as const;

/** Internal / non-customer categories. */
export const EXCLUDED_CATEGORY_NAME_PATTERNS = [
  ...PRODUCT_CATEGORY_NAME_PATTERNS,
  'إداريات',
  'اداريات',
  'عائد',
  'الخزنه',
  'الخزنة',
  'مساعدين',
] as const;

/** Internal ledger-style service names. */
export const EXCLUDED_SERVICE_NAME_PATTERNS = [
  'عائد للخزنه',
  'عائد للخزنة',
  'كاش',
  'خزنة',
  'خزنه',
] as const;

export type PublicBookingServiceRow = {
  ProID: number;
  ProName: string | null;
  ProNameAr?: string | null;
  SPrice1: number | null;
  DurationMinutes: number | null;
  isDeleted?: boolean | number | null;
  ProType?: string | null;
  CatID?: number | null;
  CatName?: string | null;
  CatType?: string | null;
  SortOrder?: number | null;
  ImageUrl?: string | null;
  /** No persisted description column today — kept for future mapping. */
  DescriptionAr?: string | null;
  DescriptionEn?: string | null;
  /** Optional future flag; absent ⇒ not hidden. */
  HideFromPublicBooking?: boolean | number | null;
};

export type ServiceEligibilityReason =
  | 'ok'
  | 'inactive_or_deleted'
  | 'retail_product'
  | 'excluded_category'
  | 'excluded_service_name'
  | 'test_or_smoke'
  | 'hidden_from_booking'
  | 'invalid_duration'
  | 'invalid_price';

export type ServiceEligibilityResult = {
  eligible: boolean;
  reason: ServiceEligibilityReason;
  durationMinutes: number | null;
  price: number | null;
};

function matchesAnyPattern(value: string, patterns: readonly string[]): boolean {
  const n = value.trim().toLowerCase();
  if (!n) return false;
  return patterns.some((p) => n.includes(p.toLowerCase()));
}

export function isSoftDeleted(isDeleted: boolean | number | null | undefined): boolean {
  return isDeleted === true || isDeleted === 1 || Number(isDeleted) === 1;
}

/** Escaped / literal match for [TEST] / [SMOKE] markers (not SQL LIKE). */
export function isTestOrSmokeServiceName(name: string | null | undefined): boolean {
  if (!name) return false;
  const upper = name.toUpperCase();
  return upper.includes('[TEST]') || upper.includes('[SMOKE');
}

export function isRetailProductClassification(row: {
  ProType?: string | null;
  CatType?: string | null;
  CatName?: string | null;
}): boolean {
  const proType = String(row.ProType ?? '')
    .trim()
    .toLowerCase();
  if (proType === 'pro' || proType === 'product') return true;

  const catType = String(row.CatType ?? '')
    .trim()
    .toLowerCase();
  if (catType === 'pro' || catType === 'product') return true;

  if (row.CatName && matchesAnyPattern(row.CatName, PRODUCT_CATEGORY_NAME_PATTERNS)) {
    return true;
  }
  return false;
}

export function isExcludedCategoryName(catName: string | null | undefined): boolean {
  if (!catName) return false;
  return matchesAnyPattern(catName, EXCLUDED_CATEGORY_NAME_PATTERNS);
}

export function isExcludedServiceName(proName: string | null | undefined): boolean {
  if (!proName) return false;
  return matchesAnyPattern(proName, EXCLUDED_SERVICE_NAME_PATTERNS);
}

/**
 * Catalog duration — must be a real positive integer on TblPro.DurationMinutes.
 * Does NOT apply system/emp fallbacks (those belong to plan/slots later).
 */
export function resolvePublicCatalogDurationMinutes(
  durationMinutes: number | null | undefined,
): number | null {
  if (durationMinutes == null) return null;
  const n = Number(durationMinutes);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded <= 0) return null;
  if (rounded > MAX_PUBLIC_BOOKING_DURATION_MINUTES) return null;
  return rounded;
}

/**
 * Public catalog price from SPrice1 (global shared catalog).
 * Null / non-finite / negative → invalid.
 * Zero is excluded until an explicit business flag exists (none today).
 */
export function resolvePublicCatalogPrice(sPrice1: number | null | undefined): number | null {
  if (sPrice1 == null) return null;
  const n = Number(sPrice1);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  if (n === 0) return null; // zero not explicitly approved in live data
  return n;
}

/** Zero-price policy helper for tests — documents current business stance. */
export function isZeroPriceAllowedForPublicBooking(): boolean {
  return false;
}

export function sanitizePublicImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  // Reject filesystem / UNC / relative local paths
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('/')) {
    return null;
  }
  if (/^(file|data|javascript):/i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function sanitizePublicDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const plain = String(raw)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  return plain.slice(0, MAX_PUBLIC_DESCRIPTION_CHARS);
}

export function evaluateServiceEligibility(
  row: PublicBookingServiceRow,
): ServiceEligibilityResult {
  if (isSoftDeleted(row.isDeleted)) {
    return { eligible: false, reason: 'inactive_or_deleted', durationMinutes: null, price: null };
  }

  if (row.HideFromPublicBooking === true || Number(row.HideFromPublicBooking) === 1) {
    return { eligible: false, reason: 'hidden_from_booking', durationMinutes: null, price: null };
  }

  if (isTestOrSmokeServiceName(row.ProName) || isTestOrSmokeServiceName(row.ProNameAr)) {
    return { eligible: false, reason: 'test_or_smoke', durationMinutes: null, price: null };
  }

  if (isRetailProductClassification(row)) {
    return { eligible: false, reason: 'retail_product', durationMinutes: null, price: null };
  }

  if (isExcludedCategoryName(row.CatName)) {
    return { eligible: false, reason: 'excluded_category', durationMinutes: null, price: null };
  }

  if (isExcludedServiceName(row.ProName) || isExcludedServiceName(row.ProNameAr)) {
    return { eligible: false, reason: 'excluded_service_name', durationMinutes: null, price: null };
  }

  const durationMinutes = resolvePublicCatalogDurationMinutes(row.DurationMinutes);
  if (durationMinutes == null) {
    return { eligible: false, reason: 'invalid_duration', durationMinutes: null, price: null };
  }

  const price = resolvePublicCatalogPrice(row.SPrice1);
  if (price == null) {
    return { eligible: false, reason: 'invalid_price', durationMinutes, price: null };
  }

  return { eligible: true, reason: 'ok', durationMinutes, price };
}

export function isServiceEligibleForPublicBooking(row: PublicBookingServiceRow): boolean {
  return evaluateServiceEligibility(row).eligible;
}

export function categoryKey(catId: number | null | undefined): string {
  if (catId == null || !Number.isFinite(Number(catId))) return UNCATEGORIZED_CATEGORY_ID;
  return String(Number(catId));
}

/**
 * Temporary bilingual labels when TblCat has only CatName (no CatNameAr column).
 * Marked temporary — prefer persisted bilingual columns when added.
 */
export const TEMPORARY_CATEGORY_LABELS: Record<
  string,
  { nameAr: string; nameEn: string }
> = {
  'hair cut': { nameAr: 'قص الشعر', nameEn: 'Hair Cut' },
  'beard cut': { nameAr: 'خدمات اللحية', nameEn: 'Beard Cut' },
  'hair styling & finishing': {
    nameAr: 'تصفيف وتشطيب',
    nameEn: 'Hair Styling & Finishing',
  },
  'hair treatments & care': {
    nameAr: 'معالجات وعناية',
    nameEn: 'Hair Treatments & Care',
  },
  'hair color & highlights': {
    nameAr: 'صبغات وهايلايت',
    nameEn: 'Hair Color & Highlights',
  },
  skincare: { nameAr: 'العناية بالبشرة', nameEn: 'Skincare' },
};

function hasArabicChars(s: string): boolean {
  return /[\u0600-\u06FF]/.test(s);
}

export function resolveCategoryNames(catName: string | null | undefined): {
  nameAr: string;
  nameEn: string;
} {
  const raw = (catName ?? '').trim();
  if (!raw) {
    return { nameAr: UNCATEGORIZED_CATEGORY_NAME_AR, nameEn: UNCATEGORIZED_CATEGORY_NAME_EN };
  }
  const mapped = TEMPORARY_CATEGORY_LABELS[raw.toLowerCase()];
  if (mapped) return mapped;
  if (hasArabicChars(raw)) {
    return { nameAr: raw, nameEn: raw };
  }
  return { nameAr: raw, nameEn: raw };
}

export function compareCategories(
  a: { sortOrder: number; nameAr: string; categoryId: string },
  b: { sortOrder: number; nameAr: string; categoryId: string },
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const nameCmp = a.nameAr.localeCompare(b.nameAr, 'ar', { sensitivity: 'base' });
  if (nameCmp !== 0) return nameCmp;
  return a.categoryId.localeCompare(b.categoryId);
}

export function compareServices(
  a: { sortOrder: number; nameAr: string; serviceId: number },
  b: { sortOrder: number; nameAr: string; serviceId: number },
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const nameCmp = a.nameAr.localeCompare(b.nameAr, 'ar', { sensitivity: 'base' });
  if (nameCmp !== 0) return nameCmp;
  return a.serviceId - b.serviceId;
}
