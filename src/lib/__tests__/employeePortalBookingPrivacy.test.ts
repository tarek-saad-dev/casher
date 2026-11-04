import { describe, expect, it } from 'vitest';
import {
  cairoTodayIso,
  maskClientFirstName,
  type MaskedPortalBooking,
} from '@/lib/employee-portal/bookingPrivacy';

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
      startTime: '10:00',
      endTime: '10:30',
      status: 'confirmed',
      firstName: 'محمد',
      serviceNames: ['حلاقة'],
      branchName: 'CUT',
    };
    const keys = Object.keys(sample).sort();
    expect(keys).toEqual(['branchName', 'endTime', 'firstName', 'serviceNames', 'startTime', 'status']);
    expect(JSON.stringify(sample)).not.toMatch(/mobile|phone|ClientName|bookingCode/i);
  });
});
