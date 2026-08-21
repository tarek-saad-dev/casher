/**
 * Booking V2 B3 — Weekly baseline projection store contract.
 *
 * Projection is rebuildable from SoT inputs. Stores are optional accelerators;
 * correctness must not depend on process-memory alone.
 */

import type { WeeklyBaselineKey, WeeklyBaselineProjectionRecord } from '@/lib/booking/domain/WeeklyBaseline';

export type WeeklyBaselineStore = {
  get(key: WeeklyBaselineKey): Promise<WeeklyBaselineProjectionRecord | null>;
  put(record: WeeklyBaselineProjectionRecord): Promise<void>;
  delete(key: WeeklyBaselineKey): Promise<void>;
  deleteMatching(filter: {
    employeeId?: number;
    branchId?: number;
    dayOfWeek?: number;
  }): Promise<number>;
  /** Optional — used by memory adapter for tests/diagnostics. */
  size?(): number;
};
