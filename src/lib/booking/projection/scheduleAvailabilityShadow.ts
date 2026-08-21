/**
 * Booking V2 B7A.5 — non-blocking shadow runners for public availability reads.
 * Never mutates the legacy response. Failures are swallowed/logged.
 */

import 'server-only';
import {
  compareAvailabilityShadow,
  logAvailabilityShadowMismatch,
  recordShadowSample,
  shouldRunBookingV2Shadow,
} from '@/lib/booking/projection/availabilityShadowParity';

export type LegacyShadowSlot = {
  time: string;
  dayOffset: 0 | 1;
  empId?: number | null;
  candidates?: Array<{ empId: number }>;
};

function flattenLegacySlots(
  employeeId: number | null,
  legacySlots: LegacyShadowSlot[],
) {
  if (employeeId != null) {
    return legacySlots.map((s) => ({
      time: s.time,
      dayOffset: s.dayOffset,
      empId: employeeId,
    }));
  }
  return legacySlots.flatMap((s) => {
    const cands = s.candidates?.length
      ? s.candidates
      : s.empId != null
        ? [{ empId: s.empId }]
        : [];
    if (!cands.length) {
      return [{ time: s.time, dayOffset: s.dayOffset }];
    }
    return cands.map((c) => ({
      time: s.time,
      dayOffset: s.dayOffset,
      empId: c.empId,
    }));
  });
}

/**
 * Fire-and-forget shadow compare against V2 FreeMask path (available-slots).
 * Uses catalog-strict durationMinutes from the public contract.
 */
export function scheduleAvailabilityShadowParity(args: {
  requestId?: string | null;
  branchId: number;
  businessDate: string;
  employeeId: number | null;
  employeeIds: number[];
  durationMinutes: number;
  slotIntervalMinutes?: number;
  minNoticeMinutes?: number;
  legacySlots: LegacyShadowSlot[];
  legacyMs?: number;
  source?: 'public' | 'operations' | 'admin';
}): void {
  if (!shouldRunBookingV2Shadow()) return;

  const run = async () => {
    try {
      const { resolveBookingAvailabilityV2 } = await import(
        '@/lib/booking/projection/resolveBookingAvailabilityV2Live'
      );
      const { getPublicSettings } = await import('@/lib/publicBookingHelpers');
      const empIds =
        args.employeeId != null
          ? [args.employeeId]
          : args.employeeIds.length
            ? args.employeeIds
            : [];
      if (!empIds.length) return;

      let minNotice = args.minNoticeMinutes;
      if (minNotice == null && (args.source ?? 'public') === 'public') {
        try {
          const settings = await getPublicSettings(args.branchId);
          minNotice = settings.minNoticeMinutes;
        } catch {
          minNotice = 30;
        }
      }
      if ((args.source === 'operations' || args.source === 'admin') && minNotice == null) {
        minNotice = 0;
      }

      const nowMs = Date.now();
      const v2 = await resolveBookingAvailabilityV2({
        employeeIds: empIds,
        branchIds: [args.branchId],
        businessDateRange: { from: args.businessDate, to: args.businessDate },
        durationMinutes: args.durationMinutes,
        slotIntervalMinutes: args.slotIntervalMinutes ?? 15,
        source: args.source ?? 'public',
        nowMs,
        minNoticeMinutes: minNotice ?? 0,
      });

      const v2Slots = v2.days.flatMap((d) =>
        d.availableStarts.map((s) => ({
          time: s.time,
          dayOffset: s.dayOffset,
          employeeId: d.employeeId,
        })),
      );

      const legacySlots = flattenLegacySlots(args.employeeId, args.legacySlots);
      const changeMask = [...new Set(v2.days.flatMap((d) => d.changeMask))];
      const revision = v2.days[0]?.availabilityRevision ?? null;

      const report = compareAvailabilityShadow({
        requestId: args.requestId,
        employeeId: args.employeeId,
        branchId: args.branchId,
        businessDate: args.businessDate,
        durationMinutes: args.durationMinutes,
        kind: 'slots',
        legacySlots,
        v2Slots,
        availabilityRevision: revision,
        changeMask,
        nowMs,
        minNoticeMinutes: minNotice ?? 0,
        hints: {
          effectiveEmpty: v2.days.every((d) => d.availableStarts.length === 0),
        },
        timing: {
          legacyMs: args.legacyMs,
          v2TotalMs: v2.totalMs,
          v2DbMs: v2.dbMs,
          v2ComposeMs: v2.composeMs,
          v2QueryCount: v2.queryCount,
        },
      });
      recordShadowSample(report);
      logAvailabilityShadowMismatch(report);
    } catch (err) {
      console.warn(
        '[booking-v2-shadow] slots failed',
        err instanceof Error ? err.message : 'error',
      );
    }
  };

  void run();
}

/**
 * Fire-and-forget available-days parity: full V2 day availability (not summary shortcut).
 * Compares isAvailable per businessDate for the sampled range.
 */
export function scheduleAvailableDaysShadowParity(args: {
  requestId?: string | null;
  branchId: number;
  employeeId: number | null;
  employeeIds: number[];
  durationMinutes: number;
  minNoticeMinutes?: number;
  days: Array<{
    date: string;
    isAvailable: boolean;
  }>;
  legacyMs?: number;
  source?: 'public' | 'operations' | 'admin';
}): void {
  if (!shouldRunBookingV2Shadow()) return;
  if (!args.days.length) return;

  const run = async () => {
    try {
      const { resolveBookingAvailabilityV2 } = await import(
        '@/lib/booking/projection/resolveBookingAvailabilityV2Live'
      );
      const { getPublicSettings } = await import('@/lib/publicBookingHelpers');
      let empIds =
        args.employeeId != null
          ? [args.employeeId]
          : args.employeeIds.length
            ? args.employeeIds
            : [];
      if (!empIds.length) {
        const { listBookableEmployeeIdsForBranch } = await import(
          '@/lib/branch/bookingQueueOwnership'
        );
        const sorted = [...args.days].map((d) => d.date).sort();
        empIds = await listBookableEmployeeIdsForBranch(
          args.branchId,
          sorted[0]!,
          { publicOnly: true },
        );
      }
      if (!empIds.length) return;

      let minNotice = args.minNoticeMinutes;
      if (minNotice == null) {
        try {
          const settings = await getPublicSettings(args.branchId);
          minNotice = settings.minNoticeMinutes;
        } catch {
          minNotice = 30;
        }
      }

      const sortedDates = [...args.days].map((d) => d.date).sort();
      const from = sortedDates[0]!;
      const to = sortedDates[sortedDates.length - 1]!;
      const nowMs = Date.now();

      const v2 = await resolveBookingAvailabilityV2({
        employeeIds: empIds,
        branchIds: [args.branchId],
        businessDateRange: { from, to },
        durationMinutes: args.durationMinutes,
        slotIntervalMinutes: 15,
        source: args.source ?? 'public',
        nowMs,
        minNoticeMinutes: minNotice ?? 0,
      });

      const v2ByDate = new Map<string, boolean>();
      for (const d of v2.days) {
        const prev = v2ByDate.get(d.businessDate) ?? false;
        v2ByDate.set(d.businessDate, prev || d.availableStarts.length > 0);
      }

      for (const day of args.days) {
        const v2Avail = v2ByDate.get(day.date) ?? false;
        const report = compareAvailabilityShadow({
          requestId: args.requestId,
          employeeId: args.employeeId,
          branchId: args.branchId,
          businessDate: day.date,
          durationMinutes: args.durationMinutes,
          kind: 'available-days',
          legacySlots: day.isAvailable
            ? [{ time: 'available', dayOffset: 0, empId: args.employeeId }]
            : [],
          v2Slots: v2Avail
            ? [{ time: 'available', dayOffset: 0, employeeId: args.employeeId ?? undefined }]
            : [],
          hints: {
            legacyIsAvailable: day.isAvailable,
            v2IsAvailable: v2Avail,
          },
          timing: {
            legacyMs: args.legacyMs,
            v2TotalMs: v2.totalMs,
            v2DbMs: v2.dbMs,
            v2ComposeMs: v2.composeMs,
            v2QueryCount: v2.queryCount,
          },
        });
        recordShadowSample(report);
        if (!report.matched) logAvailabilityShadowMismatch(report);
      }
    } catch (err) {
      console.warn(
        '[booking-v2-shadow] available-days failed',
        err instanceof Error ? err.message : 'error',
      );
    }
  };

  void run();
}

/**
 * Fire-and-forget reverse shadow: V2 is authoritative; sample-compare Legacy.
 * Used during canary/v2 read cutover (B7B).
 */
export function scheduleReverseAvailabilityShadowParity(args: {
  requestId?: string | null;
  branchId: number;
  businessDate: string;
  employeeId: number | null;
  durationMinutes: number;
  serviceIds: number[];
  minNoticeMinutes?: number;
  v2Slots: LegacyShadowSlot[];
  v2Ms?: number;
}): void {
  if (!shouldRunBookingV2Shadow()) return;

  const run = async () => {
    try {
      const { listAvailableBookingSlots } = await import(
        '@/lib/bookingAvailabilityEngine'
      );
      const nowMs = Date.now();
      const t0 = performance.now();
      const engine = await listAvailableBookingSlots({
        date: args.businessDate,
        serviceIds: args.serviceIds,
        mode: args.employeeId != null ? 'specific' : 'nearest',
        empId: args.employeeId,
        branchId: args.branchId,
        source: 'public',
        durationOverride: args.durationMinutes,
        collectAllCandidates: args.employeeId == null,
      });
      const legacyMs = performance.now() - t0;
      const legacySlots = (engine.availableSlots ?? [])
        .filter((s) => s.available)
        .map((s) => ({
          time: String(s.time).slice(0, 5),
          dayOffset: (s.dayOffset === 1 ? 1 : 0) as 0 | 1,
          empId: Number(s.empId),
          candidates: [{ empId: Number(s.empId) }],
        }));

      const v2Flat = flattenLegacySlots(args.employeeId, args.v2Slots);
      const report = compareAvailabilityShadow({
        requestId: args.requestId,
        employeeId: args.employeeId,
        branchId: args.branchId,
        businessDate: args.businessDate,
        durationMinutes: args.durationMinutes,
        kind: 'slots',
        legacySlots,
        v2Slots: v2Flat.map((s) => ({
          time: s.time,
          dayOffset: s.dayOffset,
          employeeId: s.empId ?? undefined,
        })),
        nowMs,
        minNoticeMinutes: args.minNoticeMinutes ?? 0,
        timing: {
          legacyMs,
          v2TotalMs: args.v2Ms,
        },
      });
      recordShadowSample(report);
      logAvailabilityShadowMismatch(report);
    } catch (err) {
      console.warn(
        '[booking-v2-shadow] reverse-slots failed',
        err instanceof Error ? err.message : 'error',
      );
    }
  };

  void run();
}
