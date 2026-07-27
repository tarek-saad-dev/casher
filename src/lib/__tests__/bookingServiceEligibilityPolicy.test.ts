/**
 * Booking Phase 2 — service eligibility policy unit tests.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateServiceEligibility,
  isServiceEligibleForPublicBooking,
  isTestOrSmokeServiceName,
  isZeroPriceAllowedForPublicBooking,
  resolvePublicCatalogDurationMinutes,
  resolvePublicCatalogPrice,
  sanitizePublicImageUrl,
} from '@/lib/booking/publicBookingServicePolicy';

function base(overrides: Record<string, unknown> = {}) {
  return {
    ProID: 9,
    ProName: 'Hair Cut',
    ProNameAr: 'حلاقة شعر',
    SPrice1: 200,
    DurationMinutes: 30,
    isDeleted: 0,
    ProType: 'serv',
    CatID: 19,
    CatName: 'Hair Cut',
    CatType: 'serv',
    ...overrides,
  };
}

describe('bookingServiceEligibilityPolicy', () => {
  it('accepts legitimate salon service', () => {
    expect(isServiceEligibleForPublicBooking(base())).toBe(true);
    expect(evaluateServiceEligibility(base()).reason).toBe('ok');
  });

  it('excludes soft-deleted', () => {
    expect(evaluateServiceEligibility(base({ isDeleted: 1 })).reason).toBe('inactive_or_deleted');
  });

  it('excludes retail products by ProType and CatType', () => {
    expect(evaluateServiceEligibility(base({ ProType: 'pro' })).reason).toBe('retail_product');
    expect(evaluateServiceEligibility(base({ CatType: 'pro' })).reason).toBe('retail_product');
    expect(
      evaluateServiceEligibility(base({ CatName: 'منتجات اونكس', CatType: null, ProType: null }))
        .reason,
    ).toBe('retail_product');
  });

  it('excludes inactive/internal categories and vault names', () => {
    expect(evaluateServiceEligibility(base({ CatName: 'إداريات' })).reason).toBe(
      'excluded_category',
    );
    expect(
      evaluateServiceEligibility(base({ ProName: 'عائد للخزنه ( كاش )' })).reason,
    ).toBe('excluded_service_name');
  });

  it('excludes [TEST]/[SMOKE] without broken bracket SQL semantics', () => {
    expect(isTestOrSmokeServiceName('[TEST] Cut')).toBe(true);
    expect(isTestOrSmokeServiceName('[SMOKE CC] Haircut')).toBe(true);
    expect(isTestOrSmokeServiceName('Hair Cut')).toBe(false);
    expect(evaluateServiceEligibility(base({ ProName: '[TEST] X' })).reason).toBe('test_or_smoke');
    expect(evaluateServiceEligibility(base({ ProName: '[SMOKE] Y' })).reason).toBe('test_or_smoke');
  });

  it('excludes null/zero duration and negative/null/zero price', () => {
    expect(resolvePublicCatalogDurationMinutes(null)).toBeNull();
    expect(resolvePublicCatalogDurationMinutes(0)).toBeNull();
    expect(resolvePublicCatalogDurationMinutes(-5)).toBeNull();
    expect(resolvePublicCatalogDurationMinutes(30)).toBe(30);
    expect(resolvePublicCatalogPrice(null)).toBeNull();
    expect(resolvePublicCatalogPrice(-1)).toBeNull();
    expect(resolvePublicCatalogPrice(0)).toBeNull();
    expect(isZeroPriceAllowedForPublicBooking()).toBe(false);
    expect(evaluateServiceEligibility(base({ DurationMinutes: null })).reason).toBe(
      'invalid_duration',
    );
    expect(evaluateServiceEligibility(base({ DurationMinutes: 0 })).reason).toBe(
      'invalid_duration',
    );
    expect(evaluateServiceEligibility(base({ SPrice1: -10 })).reason).toBe('invalid_price');
    expect(evaluateServiceEligibility(base({ SPrice1: 0 })).reason).toBe('invalid_price');
  });

  it('rejects unsafe image URLs', () => {
    expect(sanitizePublicImageUrl('C:\\images\\x.png')).toBeNull();
    expect(sanitizePublicImageUrl('file:///tmp/x')).toBeNull();
    expect(sanitizePublicImageUrl('https://cdn.example.com/a.jpg')).toContain('https://');
  });

  it('respects HideFromPublicBooking when present', () => {
    expect(
      evaluateServiceEligibility(base({ HideFromPublicBooking: 1 })).reason,
    ).toBe('hidden_from_booking');
  });
});
