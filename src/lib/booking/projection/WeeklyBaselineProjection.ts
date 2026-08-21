/**
 * Booking V2 B3 — WeeklyBaselineProjection service.
 *
 * Builds Emp×Branch×DayOfWeek 5-minute bitmaps from BookingPolicy-normalized
 * weekly work plans. Rebuildable entirely from SoT inputs supplied by the caller.
 *
 * Does NOT:
 * - invent a new source of truth
 * - read bookings / holds / daily adjustments
 * - expose public routes
 * - depend on Redis
 */

import { BookingPolicy } from '@/lib/booking/domain/BookingPolicy';
import {
  parseWeeklyBaselineKey,
  type WeeklyBaselineKey,
  type WeeklyBaselineProjectionRecord,
  type WeeklyBaselineSourceInputs,
} from '@/lib/booking/domain/WeeklyBaseline';
import type { WeeklyBaselineStore } from '@/lib/booking/projection/WeeklyBaselineStore';
import {
  createWeeklyBaselineRevisionBoard,
  type WeeklyBaselineInvalidationReason,
  type WeeklyBaselineRevisionBoard,
} from '@/lib/booking/projection/WeeklyBaselineRevision';
import { createWeeklyBaselineMemoryStore } from '@/lib/booking/projection/WeeklyBaselineMemoryStore';

export type WeeklyBaselineProjectionService = {
  /** Pure build — always from SoT inputs via BookingPolicy. */
  build(inputs: WeeklyBaselineSourceInputs, opts?: { revision?: number; nowMs?: number }): WeeklyBaselineProjectionRecord;
  /** Store + return; revision defaults to board.currentRevision(key). */
  rebuild(inputs: WeeklyBaselineSourceInputs, opts?: { nowMs?: number }): Promise<WeeklyBaselineProjectionRecord>;
  /**
   * Read projection if fresh (revision + fingerprint); otherwise rebuild.
   * Memory/DB miss is not an error — rebuild from inputs.
   */
  getOrRebuild(inputs: WeeklyBaselineSourceInputs, opts?: { nowMs?: number }): Promise<WeeklyBaselineProjectionRecord>;
  get(key: WeeklyBaselineKey): Promise<WeeklyBaselineProjectionRecord | null>;
  invalidate(args: {
    reason: WeeklyBaselineInvalidationReason;
    employeeId?: number;
    branchId?: number;
    dayOfWeek?: number;
    /** When true, also delete matching stored rows. */
    dropStored?: boolean;
  }): Promise<{ revision: number; deleted: number }>;
  revisionBoard: WeeklyBaselineRevisionBoard;
  store: WeeklyBaselineStore;
};

export function createWeeklyBaselineProjectionService(opts?: {
  store?: WeeklyBaselineStore;
  revisionBoard?: WeeklyBaselineRevisionBoard;
}): WeeklyBaselineProjectionService {
  const store = opts?.store ?? createWeeklyBaselineMemoryStore();
  const revisionBoard = opts?.revisionBoard ?? createWeeklyBaselineRevisionBoard();

  function build(
    inputs: WeeklyBaselineSourceInputs,
    buildOpts?: { revision?: number; nowMs?: number },
  ): WeeklyBaselineProjectionRecord {
    const key = parseWeeklyBaselineKey(inputs.key);
    const plan = BookingPolicy.normalizeWeeklyBaseline({ ...inputs, key });
    const bitmap = BookingPolicy.weeklyBaselineBitmap(plan);
    const sourceFingerprint = BookingPolicy.weeklyBaselineFingerprint({
      ...inputs,
      key,
    });
    const revision =
      buildOpts?.revision ?? revisionBoard.currentRevision(key);
    return {
      key,
      revision,
      sourceFingerprint,
      bitmap,
      freeRanges: bitmap.toFreeRanges(),
      plan,
      builtAtMs: buildOpts?.nowMs ?? Date.now(),
    };
  }

  async function rebuild(
    inputs: WeeklyBaselineSourceInputs,
    rebuildOpts?: { nowMs?: number },
  ): Promise<WeeklyBaselineProjectionRecord> {
    const key = parseWeeklyBaselineKey(inputs.key);
    const record = build(inputs, {
      revision: revisionBoard.currentRevision(key),
      nowMs: rebuildOpts?.nowMs,
    });
    await store.put(record);
    revisionBoard.noteBuilt(key, record.revision);
    return record;
  }

  return {
    build,
    rebuild,
    async getOrRebuild(inputs, getOpts) {
      const key = parseWeeklyBaselineKey(inputs.key);
      const expectedRev = revisionBoard.currentRevision(key);
      const fingerprint = BookingPolicy.weeklyBaselineFingerprint({
        ...inputs,
        key,
      });
      const existing = await store.get(key);
      if (
        existing &&
        existing.revision === expectedRev &&
        existing.sourceFingerprint === fingerprint
      ) {
        return existing;
      }
      return rebuild(inputs, getOpts);
    },
    async get(key) {
      return store.get(parseWeeklyBaselineKey(key));
    },
    async invalidate(args) {
      const { revision } = revisionBoard.invalidate(args);
      let deleted = 0;
      if (args.dropStored !== false) {
        deleted = await store.deleteMatching({
          employeeId: args.employeeId,
          branchId: args.branchId,
          dayOfWeek: args.dayOfWeek,
        });
      }
      return { revision, deleted };
    },
    revisionBoard,
    store,
  };
}

/** Default process-local service (tests / early adopters). Not wired to public APIs. */
export const WeeklyBaselineProjection = createWeeklyBaselineProjectionService();
