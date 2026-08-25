import { describe, expect, it } from 'vitest';
import { resolveBookingOriginLabel } from '@/lib/booking/bookingOriginDisplay';

describe('resolveBookingOriginLabel', () => {
  it('maps website bookings (online + user 0)', () => {
    expect(
      resolveBookingOriginLabel({ source: 'online', createdByUserId: 0 }),
    ).toEqual({ kind: 'website', label: 'الموقع' });
  });

  it('maps a system user by name', () => {
    expect(
      resolveBookingOriginLabel({
        source: 'operations',
        createdByUserId: 5,
        createdByUserName: 'أحمد',
      }),
    ).toEqual({ kind: 'user', label: 'أحمد' });
  });

  it('keeps the system user even when Source is a lead channel', () => {
    expect(
      resolveBookingOriginLabel({
        source: 'whatsapp',
        createdByUserId: 5,
        createdByUserName: 'سارة',
      }),
    ).toEqual({ kind: 'user', label: 'سارة' });
  });

  it('falls back to user id when name is missing', () => {
    expect(
      resolveBookingOriginLabel({
        source: 'operations',
        createdByUserId: 12,
        createdByUserName: '  ',
      }),
    ).toEqual({ kind: 'user', label: 'مستخدم #12' });
  });

  it('maps legacy bookings without a user as system', () => {
    expect(
      resolveBookingOriginLabel({ source: 'operations', createdByUserId: null }),
    ).toEqual({ kind: 'system', label: 'السيستم' });
  });
});
