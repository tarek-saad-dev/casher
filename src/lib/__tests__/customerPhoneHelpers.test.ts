import { describe, expect, it } from 'vitest';
import {
  isUsableCustomerPhone,
  isValidPhone,
  PLACEHOLDER_CUSTOMER_PHONES,
} from '@/lib/publicBookingHelpers';

describe('customer phone helpers', () => {
  it('accepts normal Egyptian mobiles', () => {
    expect(isValidPhone('01012345678')).toBe(true);
    expect(isUsableCustomerPhone('01012345678')).toBe(true);
  });

  it('rejects empty phone as unusable', () => {
    expect(isUsableCustomerPhone('')).toBe(false);
    expect(isUsableCustomerPhone(null)).toBe(false);
    expect(isUsableCustomerPhone(undefined)).toBe(false);
  });

  it('rejects smoke-test / placeholder phones even if format-valid', () => {
    for (const phone of PLACEHOLDER_CUSTOMER_PHONES) {
      expect(isValidPhone(phone)).toBe(true);
      expect(isUsableCustomerPhone(phone)).toBe(false);
    }
  });
});
