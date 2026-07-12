import { describe, expect, it } from 'vitest';
import { mapDayOffPolicyForBackfill } from '@/lib/migrations/employeeDayOffPolicy';

describe('mapDayOffPolicyForBackfill', () => {
  it('maps full_time with 6 working days to fixed_weekly', () => {
    expect(
      mapDayOffPolicyForBackfill({ employmentType: 'full_time', workingDayCount: 6 }),
    ).toBe('fixed_weekly');
  });

  it('maps full_time with 7 working days to flexible_weekly (محمد case)', () => {
    expect(
      mapDayOffPolicyForBackfill({ employmentType: 'full_time', workingDayCount: 7 }),
    ).toBe('flexible_weekly');
  });

  it('maps freelance and part_time to none', () => {
    expect(
      mapDayOffPolicyForBackfill({ employmentType: 'freelance', workingDayCount: 0 }),
    ).toBe('none');
    expect(
      mapDayOffPolicyForBackfill({ employmentType: 'part_time', workingDayCount: 3 }),
    ).toBe('none');
  });

  it('defaults full_time unknown schedule to fixed_weekly', () => {
    expect(
      mapDayOffPolicyForBackfill({ employmentType: 'full_time', workingDayCount: null }),
    ).toBe('fixed_weekly');
  });
});
