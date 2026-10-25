import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bookingDefaultsForBranch } from '../bookingBranchDefaults';
import { bookingSettingsValidationError } from '../bookingSettingsValidation';

describe('Salon Pack — per-branch booking setup', () => {
  it('derives identity and timezone independently for two new salons', () => {
    const nova = bookingDefaultsForBranch({ branchName: 'NOVA Salon', timeZone: 'Africa/Cairo' });
    const wave = bookingDefaultsForBranch({ branchName: 'Wave Barber', timeZone: 'Asia/Riyadh' });
    expect(nova).toMatchObject({ SalonName: 'NOVA Salon', Timezone: 'Africa/Cairo', BookingEnabled: false });
    expect(wave).toMatchObject({ SalonName: 'Wave Barber', Timezone: 'Asia/Riyadh', BookingEnabled: false });
    expect(nova.SalonName).not.toBe(wave.SalonName);
  });

  it('uses neutral fallbacks, no CUT reference and no automatic public booking activation', () => {
    expect(bookingDefaultsForBranch({ branchName: ' ', timeZone: '' })).toMatchObject({
      SalonName: 'الفرع الرئيسي',
      Timezone: 'Africa/Cairo',
      BookingEnabled: false,
      SlotIntervalMinutes: 15,
      MinNoticeMinutes: 30,
      MaxBookingDaysAhead: 14,
      DefaultServiceDurationMinutes: 30,
    });
  });

  it('accepts configured timing and rejects invalid booking horizons or durations', () => {
    expect(bookingSettingsValidationError({
      defaultMode: 'nearest',
      slotIntervalMinutes: 10,
      minNoticeMinutes: 15,
      maxBookingDaysAhead: 21,
      defaultServiceDurationMinutes: 45,
    })).toBeNull();
    for (const value of [NaN, 1.5, 0, 61, '14', null]) {
      expect(bookingSettingsValidationError({ maxBookingDaysAhead: value })).not.toBeNull();
    }
    for (const value of [NaN, 0, -10, 4, 241, '30', null]) {
      expect(bookingSettingsValidationError({ defaultServiceDurationMinutes: value })).not.toBeNull();
    }
  });

  it('keeps the admin setup bound to the active branch, without public activation', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/admin/booking-settings/route.ts'), 'utf8');
    expect(route).toContain('bookingDefaultsForBranch(branch)');
    expect(route).toContain('WHERE BranchID = @branchId');
    expect(route).toContain('ensureBranchSettingsRow(db, branch)');
    expect(route).not.toContain('N\'Cut Salon\'');
    expect(route).not.toContain('PublicBookingEnabled = 1');
    expect(route).not.toContain('LifecycleStatus = N\'PUBLIC_LIVE\'');
  });

  it('uses a generic branch confirmation, not a CUT-specific one', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/admin/branches/[id]/activate/page.tsx'), 'utf8');
    expect(page).toContain('أؤكد فتح هذا الفرع');
    expect(page).not.toContain('أؤكد فتح فرع كامب شيزار');
  });
});
