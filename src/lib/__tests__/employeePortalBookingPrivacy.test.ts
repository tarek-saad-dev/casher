import { describe, expect, it } from 'vitest';
import {
  cairoTodayIso,
  maskClientFirstName,
  type MaskedPortalBooking,
} from '@/lib/employee-portal/bookingPrivacy';
import {
  mapPortalHandoffStatus,
  normalizeHandoffServices,
  parseHandoffPayload,
  serializeHandoffPayload,
} from '@/lib/booking/cashierHandoffShared';

describe('employee portal booking privacy', () => {
  it('masks to first name only', () => {
    expect(maskClientFirstName('محمد أحمد علي')).toBe('محمد');
    expect(maskClientFirstName('  Sara  Mohamed ')).toBe('Sara');
    expect(maskClientFirstName('')).toBe('عميل');
    expect(maskClientFirstName(null)).toBe('عميل');
    expect(maskClientFirstName(undefined)).toBe('عميل');
  });

  it('formats Cairo today as YYYY-MM-DD', () => {
    const iso = cairoTodayIso(new Date('2026-11-03T22:30:00.000Z'));
    expect(iso).toMatch(/^20\d\d-\d\d-\d\d$/);
    // 22:30 UTC is 00:30 next day in Africa/Cairo (UTC+2)
    expect(iso).toBe('2026-11-04');
  });

  it('masked booking shape never includes phone or full-name fields', () => {
    const sample: MaskedPortalBooking = {
      bookingId: 42,
      startTime: '10:00',
      endTime: '10:30',
      status: 'confirmed',
      firstName: 'محمد',
      serviceNames: ['حلاقة'],
      branchName: 'CUT',
      handoffStatus: 'none',
    };
    const keys = Object.keys(sample).sort();
    expect(keys).toEqual([
      'bookingId',
      'branchName',
      'endTime',
      'firstName',
      'handoffStatus',
      'serviceNames',
      'startTime',
      'status',
    ]);
    expect(JSON.stringify(sample)).not.toMatch(/mobile|phone|ClientName|bookingCode/i);
  });
});

describe('cashier handoff payload helpers', () => {
  it('normalizes and merges duplicate pro lines', () => {
    const lines = normalizeHandoffServices([
      { proId: 1, qty: 1, source: 'booked' },
      { proId: 1, qty: 2, source: 'added' },
      { proId: 0, qty: 1 },
      { proId: 3, qty: -1 },
    ]);
    expect(lines).toEqual([{ proId: 1, qty: 3, source: 'booked' }]);
  });

  it('round-trips payload without prices', () => {
    const json = serializeHandoffPayload({
      services: [{ proId: 9, qty: 2, source: 'added' }],
    });
    expect(json).not.toMatch(/price|sPrice|mobile/i);
    expect(parseHandoffPayload(json)).toEqual({
      services: [{ proId: 9, qty: 2, source: 'added' }],
    });
  });

  it('maps portal handoff badge statuses', () => {
    expect(mapPortalHandoffStatus('pending')).toBe('pending');
    expect(mapPortalHandoffStatus('loaded')).toBe('pending');
    expect(mapPortalHandoffStatus('charged')).toBe('charged');
    expect(mapPortalHandoffStatus(null)).toBe('none');
  });
});
