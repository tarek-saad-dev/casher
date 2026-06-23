import { describe, it, expect } from 'vitest';
import {
  CUSTOMER_SOURCE_OPTIONS,
  CUSTOMER_SOURCE_VALUES,
  isKnownCustomerSource,
  getCustomerSourceLabel,
  formatCustomerSourceDisplay,
  isCustomerSourceMissing,
  isCustomerIncomplete,
  validateCustomerSource,
} from '@/lib/customerSource';
import type { Customer } from '@/lib/types';

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    ClientID: 1,
    Name: 'Test Customer',
    Mobile: '01000000000',
    BirthDate: '1990-01-01',
    Address: 'Cairo',
    RegisterDate: '2024-01-01',
    Notes: null,
    CameFrom: 'instagram',
    CameFromDetails: null,
    ReferralCode: null,
    ...overrides,
  };
}

describe('CUSTOMER_SOURCE_OPTIONS', () => {
  it('has exactly nine options with stable English values and Arabic labels', () => {
    expect(CUSTOMER_SOURCE_OPTIONS).toHaveLength(9);
    expect(CUSTOMER_SOURCE_VALUES).toContain('existing_loyal');
    expect(CUSTOMER_SOURCE_VALUES).toContain('word_of_mouth');
    expect(CUSTOMER_SOURCE_VALUES).toContain('referral_code');
    expect(CUSTOMER_SOURCE_VALUES).toContain('instagram');
    expect(CUSTOMER_SOURCE_VALUES).toContain('google_maps');
  });
});

describe('isKnownCustomerSource', () => {
  it('returns true for supported codes', () => {
    expect(isKnownCustomerSource('facebook')).toBe(true);
    expect(isKnownCustomerSource('tiktok')).toBe(true);
    expect(isKnownCustomerSource('ai')).toBe(true);
  });

  it('returns false for legacy or empty values', () => {
    expect(isKnownCustomerSource('')).toBe(false);
    expect(isKnownCustomerSource(null)).toBe(false);
    expect(isKnownCustomerSource('عميل قديم')).toBe(false);
    expect(isKnownCustomerSource('unknown_legacy')).toBe(false);
  });
});

describe('getCustomerSourceLabel', () => {
  it('returns Arabic labels for known codes', () => {
    expect(getCustomerSourceLabel('walk_by')).toBe('شاف المحل وهو معدّي');
    expect(getCustomerSourceLabel('referral_code')).toBe('كود إحالة');
  });

  it('shows legacy prefix for unknown values', () => {
    expect(getCustomerSourceLabel('old_source')).toBe('مصدر قديم: old_source');
  });
});

describe('formatCustomerSourceDisplay', () => {
  it('includes referrer name for word_of_mouth', () => {
    expect(
      formatCustomerSourceDisplay('word_of_mouth', 'أحمد محمد', null)
    ).toBe('حد قاله عنّا — أحمد محمد');
  });

  it('includes referral code for referral_code', () => {
    expect(formatCustomerSourceDisplay('referral_code', null, 'CUT123')).toBe(
      'كود إحالة — CUT123'
    );
  });

  it('returns just the label for other sources', () => {
    expect(formatCustomerSourceDisplay('instagram', null, null)).toBe('إنستجرام');
  });

  it('returns empty string for missing source', () => {
    expect(formatCustomerSourceDisplay(null, null, null)).toBe('');
  });
});

describe('isCustomerSourceMissing', () => {
  it('detects null, empty, and whitespace-only as missing', () => {
    expect(isCustomerSourceMissing(null)).toBe(true);
    expect(isCustomerSourceMissing('')).toBe(true);
    expect(isCustomerSourceMissing('   ')).toBe(true);
  });

  it('returns false for valid values', () => {
    expect(isCustomerSourceMissing('google_maps')).toBe(false);
    expect(isCustomerSourceMissing('legacy_value')).toBe(false);
  });
});

describe('isCustomerIncomplete', () => {
  it('detects missing source as incomplete', () => {
    expect(isCustomerIncomplete(makeCustomer({ CameFrom: null }))).toBe(true);
    expect(isCustomerIncomplete(makeCustomer({ CameFrom: '   ' }))).toBe(true);
  });

  it('detects missing birth date as incomplete', () => {
    expect(isCustomerIncomplete(makeCustomer({ BirthDate: null }))).toBe(true);
  });

  it('detects missing address as incomplete', () => {
    expect(isCustomerIncomplete(makeCustomer({ Address: null }))).toBe(true);
  });

  it('returns false when all fields are present', () => {
    expect(isCustomerIncomplete(makeCustomer())).toBe(false);
  });

  it('does not treat a non-empty legacy source as incomplete', () => {
    expect(isCustomerIncomplete(makeCustomer({ CameFrom: 'legacy' }))).toBe(false);
  });
});

describe('validateCustomerSource', () => {
  it('accepts a normal source and clears detail fields', () => {
    const result = validateCustomerSource('facebook', 'old detail', 'old code');
    expect(result.errors).toEqual({});
    expect(result.cameFrom).toBe('facebook');
    expect(result.cameFromDetails).toBeNull();
    expect(result.referralCode).toBeNull();
  });

  it('rejects word_of_mouth without CameFromDetails', () => {
    const result = validateCustomerSource('word_of_mouth', '', null);
    expect(result.errors.cameFromDetails).toBeTruthy();
    expect(result.cameFromDetails).toBeNull();
  });

  it('accepts word_of_mouth with CameFromDetails', () => {
    const result = validateCustomerSource('word_of_mouth', '  أحمد محمد  ', null);
    expect(result.errors).toEqual({});
    expect(result.cameFromDetails).toBe('أحمد محمد');
    expect(result.referralCode).toBeNull();
  });

  it('rejects referral_code without ReferralCode', () => {
    const result = validateCustomerSource('referral_code', null, '  ');
    expect(result.errors.referralCode).toBeTruthy();
    expect(result.referralCode).toBeNull();
  });

  it('accepts referral_code with ReferralCode', () => {
    const result = validateCustomerSource('referral_code', null, '  CUT123  ');
    expect(result.errors).toEqual({});
    expect(result.referralCode).toBe('CUT123');
    expect(result.cameFromDetails).toBeNull();
  });

  it('clears CameFromDetails when switching from word_of_mouth to instagram', () => {
    const first = validateCustomerSource('word_of_mouth', 'أحمد', null);
    expect(first.cameFromDetails).toBe('أحمد');
    const second = validateCustomerSource('instagram', first.cameFromDetails, first.referralCode);
    expect(second.errors).toEqual({});
    expect(second.cameFromDetails).toBeNull();
  });

  it('clears ReferralCode when switching from referral_code to facebook', () => {
    const first = validateCustomerSource('referral_code', null, 'CUT123');
    expect(first.referralCode).toBe('CUT123');
    const second = validateCustomerSource('facebook', first.cameFromDetails, first.referralCode);
    expect(second.errors).toEqual({});
    expect(second.referralCode).toBeNull();
  });

  it('rejects unknown source values', () => {
    const result = validateCustomerSource('legacy', null, null);
    expect(result.errors.cameFrom).toBeTruthy();
  });

  it('normalizes empty strings to null', () => {
    const result = validateCustomerSource('existing_loyal', '  ', '  ');
    expect(result.errors).toEqual({});
    expect(result.cameFrom).toBe('existing_loyal');
    expect(result.cameFromDetails).toBeNull();
    expect(result.referralCode).toBeNull();
  });
});
