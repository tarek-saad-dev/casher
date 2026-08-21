/**
 * Booking V2 B4 — EffectiveDayProjection service.
 *
 * Builds Emp×Branch×BusinessDate masks from WeeklyBaseline + date layers.
 * Normal days reuse weekly baseline (no persisted row).
 * Not wired to public available-slots / create.
 */

import { BookingPolicy } from '@/lib/booking/domain/BookingPolicy';
import {
  applyEffectiveDayLayers,
  changeMaskToArray,
  parseEffectiveDayKey,
  type EffectiveDayKey,
  type EffectiveDayLayerInputs,
  type EffectiveDayProjectionRecord,
} from '@/lib/booking/domain/EffectiveDay';
import type {
  NormalizedWeeklyBaselinePlan,
  WeeklyBaselineSourceInputs,
} from '@/lib/booking/domain/WeeklyBaseline';
import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import type { EffectiveDayStore } from '@/lib/booking/projection/EffectiveDayStore';
import { createEffectiveDayMemoryStore } from '@/lib/booking/projection/EffectiveDayMemoryStore';
import {
  createEffectiveDayRevisionBoard,
  type EffectiveDayInvalidationReason,
  type EffectiveDayRevisionBoard,
} from '@/lib/booking/projection/EffectiveDayRevision';

export type EffectiveDayBuildInput = {
  key: EffectiveDayKey;
  /** Weekly baseline SoT inputs (NOT final day-plan). */
  weeklyBaselineInputs: WeeklyBaselineSourceInputs;
  layers: EffectiveDayLayerInputs;
  /** Revision of the weekly baseline used as SourceRevision. */
  sourceRevision?: number;
};

export type EffectiveDayProjectionService = {
  build(
    input: EffectiveDayBuildInput,
    opts?: { projectionRevision?: number; nowMs?: number },
  ): EffectiveDayProjectionRecord;
  rebuild(
    input: EffectiveDayBuildInput,
    opts?: { nowMs?: number },
  ): Promise<EffectiveDayProjectionRecord>;
  getOrRebuild(
    input: EffectiveDayBuildInput,
    opts?: { nowMs?: number },
  ): Promise<EffectiveDayProjectionRecord>;
  get(key: EffectiveDayKey): Promise<EffectiveDayProjectionRecord | null>;
  invalidate(args: {
    reason: EffectiveDayInvalidationReason;
    employeeId?: number;
    branchId?: number;
    businessDate?: string;
    dropStored?: boolean;
  }): Promise<{ revision: number; deleted: number }>;
  revisionBoard: EffectiveDayRevisionBoard;
  store: EffectiveDayStore;
};

function toRecord(
  built: ReturnType<typeof applyEffectiveDayLayers>,
  args: {
    sourceRevision: number;
    projectionRevision: number;
    nowMs: number;
  },
): EffectiveDayProjectionRecord {
  return {
    key: built.key,
    sourceRevision: args.sourceRevision,
    projectionRevision: args.projectionRevision,
    changeMask: changeMaskToArray(built.changeMask),
    reusedBaseline: built.reusedBaseline,
    bitmap: built.reusedBaseline ? null : built.bitmap,
    freeRanges: built.freeRanges,
    isWorking: built.isWorking,
    sourceFingerprint: built.sourceFingerprint,
    baselineFingerprint: built.baselineFingerprint,
    builtAtMs: args.nowMs,
  };
}

export function createEffectiveDayProjectionService(opts?: {
  store?: EffectiveDayStore;
  revisionBoard?: EffectiveDayRevisionBoard;
}): EffectiveDayProjectionService {
  const store = opts?.store ?? createEffectiveDayMemoryStore();
  const revisionBoard = opts?.revisionBoard ?? createEffectiveDayRevisionBoard();

  function build(
    input: EffectiveDayBuildInput,
    buildOpts?: { projectionRevision?: number; nowMs?: number },
  ): EffectiveDayProjectionRecord {
    const key = parseEffectiveDayKey(input.key);
    const plan = BookingPolicy.normalizeWeeklyBaseline(input.weeklyBaselineInputs);
    const baselineBitmap = BookingPolicy.weeklyBaselineBitmap(plan);
    const baselineFingerprint = BookingPolicy.weeklyBaselineFingerprint(
      input.weeklyBaselineInputs,
    );
    const built = applyEffectiveDayLayers({
      key,
      baselinePlan: plan,
      baselineBitmap,
      baselineFingerprint,
      layers: input.layers,
    });
    return toRecord(built, {
      sourceRevision: input.sourceRevision ?? 1,
      projectionRevision:
        buildOpts?.projectionRevision ?? revisionBoard.currentRevision(key),
      nowMs: buildOpts?.nowMs ?? Date.now(),
    });
  }

  async function rebuild(
    input: EffectiveDayBuildInput,
    rebuildOpts?: { nowMs?: number },
  ): Promise<EffectiveDayProjectionRecord> {
    const key = parseEffectiveDayKey(input.key);
    const record = build(input, {
      projectionRevision: revisionBoard.currentRevision(key),
      nowMs: rebuildOpts?.nowMs,
    });
    await store.put(record);
    revisionBoard.noteBuilt(key, record.projectionRevision);
    return record;
  }

  return {
    build,
    rebuild,
    async getOrRebuild(input, getOpts) {
      const key = parseEffectiveDayKey(input.key);
      const expectedRev = revisionBoard.currentRevision(key);
      const builtFresh = build(input, {
        projectionRevision: expectedRev,
        nowMs: getOpts?.nowMs,
      });

      if (builtFresh.reusedBaseline) {
        await store.delete(key);
        return builtFresh;
      }

      const existing = await store.get(key);
      if (
        existing &&
        !existing.reusedBaseline &&
        existing.projectionRevision === expectedRev &&
        existing.sourceFingerprint === builtFresh.sourceFingerprint
      ) {
        return existing;
      }
      return rebuild(input, getOpts);
    },
    async get(key) {
      return store.get(parseEffectiveDayKey(key));
    },
    async invalidate(args) {
      const { revision } = revisionBoard.invalidate(args);
      let deleted = 0;
      if (args.dropStored !== false) {
        deleted = await store.deleteMatching({
          employeeId: args.employeeId,
          branchId: args.branchId,
          businessDate: args.businessDate,
        });
      }
      return { revision, deleted };
    },
    revisionBoard,
    store,
  };
}

/** Resolve effective bitmap for consumers (baseline reuse or stored divergent). */
export function resolveEffectiveDayBitmap(
  record: EffectiveDayProjectionRecord,
  baselineBitmap: AvailabilityBitmap,
): AvailabilityBitmap {
  if (record.reusedBaseline || record.bitmap == null) {
    return baselineBitmap.clone();
  }
  return record.bitmap.clone();
}

export const EffectiveDayProjection = createEffectiveDayProjectionService();

/** @internal re-export for typing */
export type { NormalizedWeeklyBaselinePlan };
