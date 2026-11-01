/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  extractPackagePublicCode,
  formatPackageCampaignMarker,
  isDateInsidePackageCampaign,
  isPackageOfferedOnDate,
  parsePackageCampaignWindow,
} from '@/lib/catalog/packageCampaignWindow';

describe('packageCampaignWindow', () => {
  const marker = formatPackageCampaignMarker({
    code: 'NOV-PRO600',
    from: '2026-11-01',
    to: '2026-11-30',
    timezone: 'Africa/Cairo',
  });

  it('round-trips campaign marker in NotesAr', () => {
    const notes = `[seed:NOV-PRO600] ${marker}`;
    expect(parsePackageCampaignWindow(notes)).toEqual({
      code: 'NOV-PRO600',
      from: '2026-11-01',
      to: '2026-11-30',
      timezone: 'Africa/Cairo',
    });
  });

  it('treats campaign dates as inclusive', () => {
    const window = parsePackageCampaignWindow(marker)!;
    expect(isDateInsidePackageCampaign(window, '2026-10-31')).toBe(false);
    expect(isDateInsidePackageCampaign(window, '2026-11-01')).toBe(true);
    expect(isDateInsidePackageCampaign(window, '2026-11-15')).toBe(true);
    expect(isDateInsidePackageCampaign(window, '2026-11-30')).toBe(true);
    expect(isDateInsidePackageCampaign(window, '2026-12-01')).toBe(false);
  });

  it('packages without campaign marker stay offered', () => {
    expect(isPackageOfferedOnDate(null, '2026-11-15')).toBe(true);
    expect(isPackageOfferedOnDate('[seed:GROOM_X]', '2026-01-01')).toBe(true);
  });

  it('rejects inverted windows', () => {
    expect(
      parsePackageCampaignWindow(
        '[campaign:code=X;from=2026-11-30;to=2026-11-01;tz=Africa/Cairo]',
      ),
    ).toBeNull();
  });

  it('extracts public package code from campaign or seed marker', () => {
    expect(extractPackagePublicCode(`[seed:NOV-PRO600] ${marker}`)).toBe('NOV-PRO600');
    expect(extractPackagePublicCode('[seed:REGULAR_OCTOBER_2026]')).toBe('REGULAR_OCTOBER_2026');
    expect(extractPackagePublicCode(null)).toBeNull();
  });
});
