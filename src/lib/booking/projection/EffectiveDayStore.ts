/**
 * Booking V2 B4 — Effective Day projection store contract.
 * Only date-divergent masks should be persisted (reusedBaseline → no row).
 */

import type {
  EffectiveDayKey,
  EffectiveDayProjectionRecord,
} from '@/lib/booking/domain/EffectiveDay';

export type EffectiveDayStore = {
  get(key: EffectiveDayKey): Promise<EffectiveDayProjectionRecord | null>;
  put(record: EffectiveDayProjectionRecord): Promise<void>;
  delete(key: EffectiveDayKey): Promise<void>;
  deleteMatching(filter: {
    employeeId?: number;
    branchId?: number;
    businessDate?: string;
  }): Promise<number>;
  size?(): number;
};
