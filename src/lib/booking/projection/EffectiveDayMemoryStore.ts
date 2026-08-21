/**
 * In-memory Effective Day store (tests / process-local). Not Redis.
 */

import {
  effectiveDayKeyString,
  parseEffectiveDayKey,
  type EffectiveDayKey,
  type EffectiveDayProjectionRecord,
} from '@/lib/booking/domain/EffectiveDay';
import type { EffectiveDayStore } from '@/lib/booking/projection/EffectiveDayStore';

export function createEffectiveDayMemoryStore(): EffectiveDayStore {
  const map = new Map<string, EffectiveDayProjectionRecord>();

  return {
    async get(key) {
      return map.get(effectiveDayKeyString(parseEffectiveDayKey(key))) ?? null;
    },
    async put(record) {
      if (record.reusedBaseline) {
        // Spec: do not store a new bitmap for normal days.
        map.delete(effectiveDayKeyString(record.key));
        return;
      }
      map.set(effectiveDayKeyString(record.key), record);
    },
    async delete(key) {
      map.delete(effectiveDayKeyString(parseEffectiveDayKey(key)));
    },
    async deleteMatching(filter) {
      let n = 0;
      for (const [id, rec] of map) {
        if (filter.employeeId != null && rec.key.employeeId !== filter.employeeId) continue;
        if (filter.branchId != null && rec.key.branchId !== filter.branchId) continue;
        if (
          filter.businessDate != null &&
          String(rec.key.businessDate) !== filter.businessDate
        ) {
          continue;
        }
        map.delete(id);
        n++;
      }
      return n;
    },
    size() {
      return map.size;
    },
  };
}
