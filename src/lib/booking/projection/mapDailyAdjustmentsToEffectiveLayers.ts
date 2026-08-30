import type { EmployeeDailyAdjustment } from '@/lib/availability/dailyAdjustments';
import type { EffectiveDayDailyAdjustmentLayer } from '@/lib/booking/domain/EffectiveDay';

/** Map canonical daily adjustments (window table) → EffectiveDay layer inputs. */
export function mapEmployeeDailyAdjustmentsToEffectiveLayers(
  adjustments: EmployeeDailyAdjustment[],
): EffectiveDayDailyAdjustmentLayer[] {
  return adjustments.map((adj) => {
    const windows = adj.windows.map((w) => ({
      startHhmm: w.start,
      endHhmm: w.end,
      endDayOffset: w.endDayOffset,
    }));
    switch (adj.adjustmentType) {
      case 'CLOSE_DAY':
        return { type: 'CLOSE_DAY' };
      case 'REPLACE_WINDOWS':
        return { type: 'REPLACE_WINDOWS', windows };
      case 'ADD_WINDOW':
        return { type: 'ADD_WINDOW', windows };
      case 'BLOCK_WINDOW':
        return { type: 'BLOCK_WINDOW', windows };
      default:
        return { type: 'CLOSE_DAY' };
    }
  });
}
