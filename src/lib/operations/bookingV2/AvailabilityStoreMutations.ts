/**
 * Booking V2 Phase O2.5 — local availability mutation + targeted revalidation.
 * Components call mutationSync.ts; this module owns store patches only.
 */

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import type { V2PublicAvailabilityDayDto } from '@/lib/booking/v2Frontend/publicSafeDtos';
import { fetchAvailabilityMatrix } from '@/lib/operations/bookingV2/availabilityClient';
import {
  computeTimelineOverlapMinutes,
  fallbackDayWindowMs,
  type AvailabilityOccupancyInterval,
} from '@/lib/operations/bookingV2/intervalAuthority';
import {
  commitBookingV2StoreUpdate,
  getBookingV2StoreSnapshot,
  recomputeGeneratedStartsForSnapshot,
  resolveEmployeeBranchCodesFromSnapshot,
} from '@/lib/operations/bookingV2/store';
import {
  matrixScopeKey,
  revisionKey,
  type MatrixCacheEntry,
  type MatrixScope,
} from '@/lib/operations/bookingV2/types';
import {
  isTraceDay,
  traceDayFromMatrixEntry,
  traceLog,
  traceMaskAllows,
  traceScopeLabel,
  traceStartsInclude,
  traceSummaryForDay,
} from '@/lib/operations/bookingV2/traceSlotDebug';

const targetedInflight = new Map<string, Promise<void>>();
const targetedSeqByKey = new Map<string, number>();

function nextTargetedSeq(key: string): number {
  const seq = (targetedSeqByKey.get(key) ?? 0) + 1;
  targetedSeqByKey.set(key, seq);
  return seq;
}

function patchDayOccupied(
  day: V2PublicAvailabilityDayDto,
  interval: AvailabilityOccupancyInterval,
): V2PublicAvailabilityDayDto {
  if (day.employeeId !== interval.employeeId) return day;

  const window =
    day.businessDayStartAtMs > 0 && day.timelineEndAtMs > day.businessDayStartAtMs
      ? { startMs: day.businessDayStartAtMs, endMs: day.timelineEndAtMs }
      : fallbackDayWindowMs(day.businessDate, day.timezone);

  const overlap = computeTimelineOverlapMinutes({
    businessDayStartAtMs: window.startMs,
    timelineEndAtMs: window.endMs,
    startAtMs: interval.startAtMs,
    endAtMs: interval.endAtMs,
  });
  if (!overlap) return day;

  const mask = AvailabilityBitmap.fromBase64(day.freeMaskB64);
  mask.clearRange(overlap.startMin, overlap.endMin);
  const freeRanges = mask.toFreeRanges();

  return {
    ...day,
    freeMaskB64: mask.toBase64(),
    freeRanges,
    isAvailable: freeRanges.length > 0,
  };
}

function buildRevisions(matrix: MatrixCacheEntry['matrix']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of matrix.days) {
    out[revisionKey(d.employeeId, d.branchCode, d.businessDate)] = d.availabilityRevision;
  }
  return out;
}

function applyOccupiedIntervalToAllCaches(interval: AvailabilityOccupancyInterval): boolean {
  let changed = false;
  commitBookingV2StoreUpdate((prev) => {
    const matricesByKey = { ...prev.matricesByKey };
    for (const [key, entry] of Object.entries(matricesByKey)) {
      if (
        entry.scope.kind === 'employee'
        && entry.scope.employeeId !== interval.employeeId
      ) {
        continue;
      }

      let entryChanged = false;
      const days = entry.matrix.days.map((day) => {
        if (day.employeeId !== interval.employeeId) return day;
        const next = patchDayOccupied(day, interval);
        if (next !== day) entryChanged = true;
        return next;
      });

      if (entryChanged) {
        changed = true;
        const matrix = { ...entry.matrix, days };
        matricesByKey[key] = {
          ...entry,
          matrix,
          revisions: buildRevisions(matrix),
        };
      }
    }

    if (!changed) return prev;

    const merged = { ...prev, matricesByKey };
    return {
      ...merged,
      generatedStarts: recomputeGeneratedStartsForSnapshot(merged),
    };
  });
  return changed;
}

function dayPayloadEqual(
  local: V2PublicAvailabilityDayDto,
  auth: V2PublicAvailabilityDayDto,
): boolean {
  return (
    local.availabilityRevision === auth.availabilityRevision
    && local.freeMaskB64 === auth.freeMaskB64
    && local.isAvailable === auth.isAvailable
  );
}

function mergeAuthoritativeDays(authoritativeDays: V2PublicAvailabilityDayDto[]): boolean {
  if (!authoritativeDays.length) return false;
  const traceAuthDay = authoritativeDays.find(isTraceDay);
  traceLog('[trace-slot][targeted-response]', {
    traceDay: traceSummaryForDay(traceAuthDay),
  });
  const byKey = new Map(
    authoritativeDays.map((d) => [revisionKey(d.employeeId, d.branchCode, d.businessDate), d]),
  );

  let changed = false;
  commitBookingV2StoreUpdate((prev) => {
    const matricesByKey = { ...prev.matricesByKey };
    const availabilityRevisions = { ...prev.availabilityRevisions };

    for (const [cacheKey, entry] of Object.entries(matricesByKey)) {
      const beforeTraceDay = traceDayFromMatrixEntry(entry);
      let entryChanged = false;
      const days = entry.matrix.days.map((day) => {
        const rk = revisionKey(day.employeeId, day.branchCode, day.businessDate);
        const auth = byKey.get(rk);
        if (!auth) return day;
        if (dayPayloadEqual(day, auth)) {
          console.log('[merge-auth] SKIP (equal)', rk, { localMask: day.freeMaskB64?.slice(0, 20), authMask: auth.freeMaskB64?.slice(0, 20), rev: auth.availabilityRevision });
          return day;
        }
        console.log('[merge-auth] REPLACE', rk, { localMask: day.freeMaskB64?.slice(0, 20), authMask: auth.freeMaskB64?.slice(0, 20), localRev: day.availabilityRevision, authRev: auth.availabilityRevision });
        entryChanged = true;
        availabilityRevisions[rk] = auth.availabilityRevision;
        return auth;
      });

      if (entryChanged) {
        changed = true;
        const matrix = { ...entry.matrix, days };
        matricesByKey[cacheKey] = {
          ...entry,
          matrix,
          fetchedAt: Date.now(),
          revisions: buildRevisions(matrix),
        };
        traceLog('[trace-slot][mergeAuthoritativeDays][updated-matrix]', {
          matrixKey: cacheKey,
          scope: traceScopeLabel(entry.scope),
          oldTraceDay: traceSummaryForDay(beforeTraceDay),
          newTraceDay: traceSummaryForDay(traceDayFromMatrixEntry(matricesByKey[cacheKey])),
          storedMatrixContains16_00: traceMaskAllows(traceDayFromMatrixEntry(matricesByKey[cacheKey])),
        });
      }
    }

    if (!changed) {
      console.log('[merge-auth] NO CHANGE — returning prev snapshot');
      return prev;
    }

    const merged = {
      ...prev,
      matricesByKey,
      availabilityRevisions,
      availabilityRevalidating: false,
    };
    const result = {
      ...merged,
      generatedStarts: recomputeGeneratedStartsForSnapshot(merged),
    };
    console.log('[merge-auth] MERGED — new starts count:', result.generatedStarts.length);
    traceLog('[trace-slot][mergeAuthoritativeDays][result]', {
      activeMatrixKey: result.activeMatrixKey,
      generatedIncludes16_00: traceStartsInclude(result.generatedStarts),
    });
    return result;
  });

  return changed;
}

async function fetchTargetedDays(args: {
  employeeId: number;
  branchCodes: string[];
  businessDates: string[];
}): Promise<V2PublicAvailabilityDayDto[]> {
  const dates = [...new Set(args.businessDates.map((d) => d.slice(0, 10)))].sort();
  if (!dates.length) return [];

  const scope: MatrixScope = {
    kind: 'employee',
    employeeId: args.employeeId,
    branchCodes: args.branchCodes.map((c) => c.toUpperCase()),
    fromBusinessDate: dates[0]!,
    toBusinessDate: dates[dates.length - 1]!,
  };

  const matrix = await fetchAvailabilityMatrix({
    scope,
    key: `targeted:${matrixScopeKey(scope)}:${dates.join(',')}`,
  });
  traceLog('[trace-slot][fetchTargetedDays]', {
    requestedMatrixScopeKey: `targeted:${matrixScopeKey(scope)}:${dates.join(',')}`,
    scope: traceScopeLabel(scope),
    traceDay: traceSummaryForDay(matrix.days.find(isTraceDay)),
  });

  const wanted = new Set(dates);
  return matrix.days.filter((d) => wanted.has(d.businessDate));
}

export function revalidateAffectedAvailability(args: {
  employeeId: number;
  businessDates: string[];
  branchCodes?: string[];
}): Promise<void> {
  const dates = [...new Set(args.businessDates.map((d) => d.slice(0, 10)))].sort();
  if (!dates.length) return Promise.resolve();

  const snapshot = getBookingV2StoreSnapshot();
  console.log('[booking-v2-revalidate] start', {
    empId: args.employeeId,
    dates,
    matrixKeys: Object.keys(snapshot.matricesByKey),
    activeKey: snapshot.activeMatrixKey,
  });
  const branchCodes =
    args.branchCodes?.length
      ? args.branchCodes
      : resolveEmployeeBranchCodesFromSnapshot(snapshot, args.employeeId);

  const inflightKey = `${args.employeeId}|${branchCodes.join(',')}|${dates.join(',')}`;
  const seq = nextTargetedSeq(inflightKey);

  commitBookingV2StoreUpdate((prev) => ({
    ...prev,
    availabilityRevalidating: true,
    availabilityError: null,
  }));

  const run = (async () => {
    try {
      const days = await fetchTargetedDays({
        employeeId: args.employeeId,
        branchCodes,
        businessDates: dates,
      });
      if (targetedSeqByKey.get(inflightKey) !== seq) return;
      mergeAuthoritativeDays(days);
    } catch (err) {
      if (targetedSeqByKey.get(inflightKey) !== seq) return;
      const message = err instanceof Error ? err.message : 'تعذر تحديث التوفر';
      commitBookingV2StoreUpdate((prev) => ({
        ...prev,
        availabilityRevalidating: false,
        availabilityError: message,
      }));
    } finally {
      if (targetedSeqByKey.get(inflightKey) === seq) {
        commitBookingV2StoreUpdate((prev) => ({
          ...prev,
          availabilityRevalidating: false,
        }));
        targetedInflight.delete(inflightKey);
      }
    }
  })();

  targetedInflight.set(inflightKey, run);
  return run;
}

/** Instant remove — EmpID is global across branch caches. */
export function applyBookingCreated(interval: AvailabilityOccupancyInterval): void {
  applyOccupiedIntervalToAllCaches(interval);
  void revalidateAffectedAvailability({
    employeeId: interval.employeeId,
    businessDates: [interval.businessDate],
    branchCodes: interval.branchCode ? [interval.branchCode] : undefined,
  });
}

export function applyHoldCreated(interval: AvailabilityOccupancyInterval): void {
  applyBookingCreated(interval);
}

export function applyBookingRescheduled(args: {
  newInterval: AvailabilityOccupancyInterval;
  oldInterval: AvailabilityOccupancyInterval;
}): void {
  applyOccupiedIntervalToAllCaches(args.newInterval);
  const dates = [
    args.oldInterval.businessDate,
    args.newInterval.businessDate,
  ];
  void revalidateAffectedAvailability({
    employeeId: args.newInterval.employeeId,
    businessDates: dates,
  });
  if (args.oldInterval.employeeId !== args.newInterval.employeeId) {
    void revalidateAffectedAvailability({
      employeeId: args.oldInterval.employeeId,
      businessDates: [args.oldInterval.businessDate],
    });
  }
}

/** Conservative restore — never blind-add free time. Revalidate all branches for EmpID. */
export function applyBookingCancelled(args: {
  employeeId: number;
  businessDate: string;
  branchCode?: string;
}): Promise<void> {
  console.log('[booking-v2-cancel] applyBookingCancelled called', { empId: args.employeeId, date: args.businessDate, branchCode: args.branchCode });
  return revalidateAffectedAvailability({
    employeeId: args.employeeId,
    businessDates: [args.businessDate],
  });
}

export function applyHoldReleased(args: {
  employeeId: number;
  businessDate: string;
  branchCode?: string;
}): Promise<void> {
  return applyBookingCancelled(args);
}

export function invalidateEmployeeDay(args: {
  employeeId: number;
  businessDate: string;
  branchCode?: string;
}): void {
  void revalidateAffectedAvailability({
    employeeId: args.employeeId,
    businessDates: [args.businessDate],
    branchCodes: args.branchCode ? [args.branchCode] : undefined,
  });
}

export function applyQueueOccupancy(interval: AvailabilityOccupancyInterval): void {
  applyOccupiedIntervalToAllCaches(interval);
  void revalidateAffectedAvailability({
    employeeId: interval.employeeId,
    businessDates: [interval.businessDate],
    branchCodes: interval.branchCode ? [interval.branchCode] : undefined,
  });
}

export function applySlotUnavailableRefresh(args: {
  employeeId: number;
  businessDate: string;
  branchCode?: string;
}): void {
  void revalidateAffectedAvailability({
    employeeId: args.employeeId,
    businessDates: [args.businessDate],
    branchCodes: args.branchCode ? [args.branchCode] : undefined,
  });
}

/** Test helper */
export function clearTargetedRevalidationInflight(): void {
  targetedInflight.clear();
  targetedSeqByKey.clear();
}
