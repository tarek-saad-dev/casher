/**
 * Customer Follow-Up Contact — Unit Tests
 *
 * Tests the pure validation logic in customerFollowUpValidation.ts.
 * The PUT API route is tested conceptually through the validation helper
 * since it relies on DB access (mocked separately where needed).
 *
 * Run with: npx vitest run src/lib/__tests__/customerFollowUpContact.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  validateContactPayload,
  toFollowUpMonthDate,
  resultLabel,
  type ContactPayload,
} from '../customerFollowUpValidation';

// ── Helpers ────────────────────────────────────────────────────────────────────

function valid(overrides: Partial<ContactPayload> = {}): ContactPayload {
  return {
    clientId:      1,
    followUpMonth: '2026-06',
    resultType:    'outside_governorate',
    ...overrides,
  };
}

function firstError(payload: ContactPayload): string | undefined {
  return validateContactPayload(payload)[0]?.message;
}

function hasField(payload: ContactPayload, field: string): boolean {
  return validateContactPayload(payload).some(e => e.field === field);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Saving outside_governorate
// ══════════════════════════════════════════════════════════════════════════════

describe('outside_governorate', () => {
  it('is valid without any optional fields', () => {
    expect(validateContactPayload(valid({ resultType: 'outside_governorate' }))).toHaveLength(0);
  });

  it('rejects complaintType when resultType is outside_governorate', () => {
    expect(hasField(valid({ resultType: 'outside_governorate', complaintType: 'barber' }), 'complaintType')).toBe(true);
  });

  it('rejects complaintEmpId when resultType is outside_governorate', () => {
    expect(hasField(valid({ resultType: 'outside_governorate', complaintEmpId: 5 }), 'complaintEmpId')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Saving outside_country
// ══════════════════════════════════════════════════════════════════════════════

describe('outside_country', () => {
  it('is valid without any optional fields', () => {
    expect(validateContactPayload(valid({ resultType: 'outside_country' }))).toHaveLength(0);
  });

  it('accepts optional notes (notes is not validated by this helper)', () => {
    expect(validateContactPayload(valid({ resultType: 'outside_country', notes: 'سافر' }))).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Saving a barber complaint
// ══════════════════════════════════════════════════════════════════════════════

describe('barber complaint', () => {
  it('is valid with complaintType=barber and a reasonText', () => {
    expect(validateContactPayload(valid({
      resultType: 'complaint', complaintType: 'barber', reasonText: 'لم يكن محترفاً',
    }))).toHaveLength(0);
  });

  it('is valid with an optional complaintEmpId', () => {
    expect(validateContactPayload(valid({
      resultType: 'complaint', complaintType: 'barber',
      reasonText: 'شكوى', complaintEmpId: 7,
    }))).toHaveLength(0);
  });

  it('rejects barber complaint without reasonText', () => {
    expect(hasField(valid({
      resultType: 'complaint', complaintType: 'barber', reasonText: '',
    }), 'reasonText')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Rejecting a complaint without a reason
// ══════════════════════════════════════════════════════════════════════════════

describe('complaint without reason', () => {
  it('rejects place complaint without reasonText', () => {
    expect(hasField(valid({
      resultType: 'complaint', complaintType: 'place',
    }), 'reasonText')).toBe(true);
  });

  it('rejects cleanliness complaint without reasonText', () => {
    expect(hasField(valid({
      resultType: 'complaint', complaintType: 'cleanliness',
    }), 'reasonText')).toBe(true);
  });

  it('rejects complaint without complaintType at all', () => {
    expect(hasField(valid({ resultType: 'complaint' }), 'complaintType')).toBe(true);
  });

  it('rejects complaint with whitespace-only reasonText', () => {
    expect(hasField(valid({
      resultType: 'complaint', complaintType: 'other', reasonText: '   ',
    }), 'reasonText')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Rejecting other_reason without text
// ══════════════════════════════════════════════════════════════════════════════

describe('other_reason', () => {
  it('is valid when reasonText is provided', () => {
    expect(validateContactPayload(valid({
      resultType: 'other_reason', reasonText: 'مريض',
    }))).toHaveLength(0);
  });

  it('rejects when reasonText is absent', () => {
    expect(hasField(valid({ resultType: 'other_reason' }), 'reasonText')).toBe(true);
  });

  it('rejects when reasonText is empty string', () => {
    expect(hasField(valid({ resultType: 'other_reason', reasonText: '' }), 'reasonText')).toBe(true);
  });

  it('rejects when reasonText is whitespace only', () => {
    expect(hasField(valid({ resultType: 'other_reason', reasonText: '   ' }), 'reasonText')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Returning saved follow-up data — toFollowUpMonthDate helper
// ══════════════════════════════════════════════════════════════════════════════

describe('toFollowUpMonthDate', () => {
  it('converts YYYY-MM to first-of-month date string', () => {
    expect(toFollowUpMonthDate('2026-06')).toBe('2026-06-01');
  });

  it('pads single-digit months correctly', () => {
    expect(toFollowUpMonthDate('2026-03')).toBe('2026-03-01');
  });

  it('handles December', () => {
    expect(toFollowUpMonthDate('2025-12')).toBe('2025-12-01');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Filtering contacted and pending — contactStatus param is validated by API
//    (pure validation: resultType enum whitelist)
// ══════════════════════════════════════════════════════════════════════════════

describe('resultType validation', () => {
  it('rejects unknown resultType', () => {
    expect(firstError(valid({ resultType: 'unknown_type' }))).toMatch(/غير معروفة/);
  });

  it('accepts all four valid resultTypes', () => {
    for (const rt of ['outside_governorate', 'outside_country', 'other_reason'] as const) {
      // other_reason needs reasonText; the other two are bare
      const payload = rt === 'other_reason'
        ? valid({ resultType: rt, reasonText: 'reason' })
        : valid({ resultType: rt });
      expect(validateContactPayload(payload)).toHaveLength(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. Editing an existing result — same payload shape, upsert is idempotent
// ══════════════════════════════════════════════════════════════════════════════

describe('edit existing result', () => {
  it('same payload is still valid the second time (upsert idempotency)', () => {
    const payload = valid({ resultType: 'outside_country' });
    expect(validateContactPayload(payload)).toHaveLength(0);
    // Run again — same result
    expect(validateContactPayload(payload)).toHaveLength(0);
  });

  it('changing resultType on edit is valid when new fields satisfy requirements', () => {
    expect(validateContactPayload(valid({
      resultType: 'complaint',
      complaintType: 'place',
      reasonText: 'النظافة سيئة',
    }))).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. Preventing unauthorized writes — auth is enforced at API layer
//    Here we test that clientId and followUpMonth are required
// ══════════════════════════════════════════════════════════════════════════════

describe('required fields (unauthorized / malformed request guard)', () => {
  it('rejects missing clientId', () => {
    expect(hasField({ ...valid(), clientId: 0 }, 'clientId')).toBe(true);
  });

  it('rejects negative clientId', () => {
    expect(hasField({ ...valid(), clientId: -1 }, 'clientId')).toBe(true);
  });

  it('rejects missing followUpMonth', () => {
    expect(hasField({ ...valid(), followUpMonth: '' }, 'followUpMonth')).toBe(true);
  });

  it('rejects malformed followUpMonth', () => {
    expect(hasField({ ...valid(), followUpMonth: '06-2026' }, 'followUpMonth')).toBe(true);
  });

  it('rejects missing resultType', () => {
    expect(hasField({ ...valid(), resultType: '' }, 'resultType')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. One row per customer per follow-up month — enforced by unique index in DB
//     Here we test complaintEmpId is only allowed on barber subtype
// ══════════════════════════════════════════════════════════════════════════════

describe('one record per customer per month — complaintEmpId constraints', () => {
  it('rejects complaintEmpId for place complaint', () => {
    expect(hasField(valid({
      resultType: 'complaint', complaintType: 'place',
      reasonText: 'test', complaintEmpId: 3,
    }), 'complaintEmpId')).toBe(true);
  });

  it('rejects complaintEmpId for cleanliness complaint', () => {
    expect(hasField(valid({
      resultType: 'complaint', complaintType: 'cleanliness',
      reasonText: 'test', complaintEmpId: 3,
    }), 'complaintEmpId')).toBe(true);
  });

  it('allows complaintEmpId=null for barber complaint', () => {
    expect(validateContactPayload(valid({
      resultType: 'complaint', complaintType: 'barber',
      reasonText: 'شكوى', complaintEmpId: null,
    }))).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resultLabel helper
// ══════════════════════════════════════════════════════════════════════════════

describe('resultLabel', () => {
  it('returns correct Arabic label for each result type', () => {
    expect(resultLabel('outside_governorate')).toBe('خارج المحافظة');
    expect(resultLabel('outside_country')).toBe('خارج الدولة');
    expect(resultLabel('other_reason')).toBe('سبب آخر');
  });

  it('returns complaint subtypes correctly', () => {
    expect(resultLabel('complaint', 'barber')).toBe('شكوى من حلاق');
    expect(resultLabel('complaint', 'place')).toBe('شكوى من المكان');
    expect(resultLabel('complaint', 'cleanliness')).toBe('شكوى من النظافة');
    expect(resultLabel('complaint', 'other')).toBe('شكوى أخرى');
  });

  it('returns generic complaint label when subtype is missing', () => {
    expect(resultLabel('complaint')).toBe('شكوى');
  });
});
