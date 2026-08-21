/**
 * Process-memory adapter for weekly baseline projections.
 * Optional accelerator only — never the sole source of correctness.
 */

import {
  weeklyBaselineKeyString,
  type WeeklyBaselineKey,
  type WeeklyBaselineProjectionRecord,
} from '@/lib/booking/domain/WeeklyBaseline';
import type { WeeklyBaselineStore } from '@/lib/booking/projection/WeeklyBaselineStore';

export function createWeeklyBaselineMemoryStore(): WeeklyBaselineStore {
  const map = new Map<string, WeeklyBaselineProjectionRecord>();

  return {
    async get(key) {
      return map.get(weeklyBaselineKeyString(key)) ?? null;
    },
    async put(record) {
      map.set(weeklyBaselineKeyString(record.key), {
        ...record,
        bitmap: record.bitmap.clone(),
        freeRanges: record.freeRanges.map((r) => ({ ...r })),
      });
    },
    async delete(key) {
      map.delete(weeklyBaselineKeyString(key));
    },
    async deleteMatching(filter) {
      let n = 0;
      for (const [k, rec] of map) {
        if (filter.employeeId != null && rec.key.employeeId !== filter.employeeId) continue;
        if (filter.branchId != null && rec.key.branchId !== filter.branchId) continue;
        if (filter.dayOfWeek != null && rec.key.dayOfWeek !== filter.dayOfWeek) continue;
        map.delete(k);
        n++;
      }
      return n;
    },
    size() {
      return map.size;
    },
  };
}
