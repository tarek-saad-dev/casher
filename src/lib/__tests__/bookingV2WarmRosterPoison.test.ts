/**
 * Warm matrix context must not cache empty roster from specific-emp loads.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  getOrLoadWarmMatrixContext,
  __resetWarmMatrixContextForTests,
} from '@/lib/booking/cache/WarmMatrixContextCache';

describe('WarmMatrixContext roster poison guard', () => {
  beforeEach(() => {
    __resetWarmMatrixContextForTests();
  });

  it('specific-emp load (no roster) does not block later roster fetch', async () => {
    let rosterLoads = 0;

    // 1) Prime context without roster (specific barber path).
    await getOrLoadWarmMatrixContext({
      branchCode: 'GLEEM',
      asOfDate: '2026-08-16',
      load: async () => ({
        branch: { branchId: 1, branchCode: 'GLEEM', timezone: 'Africa/Cairo' },
        settings: {
          branchId: 1,
          timezone: 'Africa/Cairo',
          slotIntervalMinutes: 15,
          maxBookingDaysAhead: 14,
          minNoticeMinutes: 0,
          currency: 'EGP',
        },
        // undefined = do not write rosterByAsOf
        rosterEmpIds: undefined,
      }),
    });

    // 2) Roster path must still load.
    const second = await getOrLoadWarmMatrixContext({
      branchCode: 'GLEEM',
      asOfDate: '2026-08-16',
      load: async () => {
        rosterLoads += 1;
        return {
          branch: { branchId: 1, branchCode: 'GLEEM', timezone: 'Africa/Cairo' },
          settings: {
            branchId: 1,
            timezone: 'Africa/Cairo',
            slotIntervalMinutes: 15,
            maxBookingDaysAhead: 14,
            minNoticeMinutes: 0,
            currency: 'EGP',
          },
          rosterEmpIds: [12, 25],
        };
      },
    });

    expect(rosterLoads).toBe(1);
    expect(second.entry.rosterByAsOf.get('2026-08-16')).toEqual([12, 25]);
  });
});
