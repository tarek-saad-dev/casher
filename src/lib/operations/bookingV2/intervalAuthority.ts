/**
 * Authoritative occupancy intervals for Booking V2 local mutations (Phase O2.5).
 * Prefer create/reschedule response fields; fall back to validated workspace slot state.
 */

import { salonWallToEpochMs, V2_SLOT_TZ } from '@/lib/booking/v2Frontend/v2SlotStart';

export type AvailabilityOccupancyInterval = {
  employeeId: number;
  branchCode?: string;
  businessDate: string;
  startAtMs: number;
  endAtMs: number;
};

export type BookingCreateSlotFallback = {
  empId: number;
  branchCode?: string | null;
  businessDate: string;
  startAt: string;
  endAt: string;
};

function parseMs(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Create response + optional validated slot at submit time. */
export function resolveBookingCreatedInterval(args: {
  createResponse?: unknown;
  fallbackSlot?: BookingCreateSlotFallback | null;
}): AvailabilityOccupancyInterval | null {
  const booking =
    args.createResponse && typeof args.createResponse === 'object'
      ? (args.createResponse as { booking?: Record<string, unknown> }).booking
      : null;

  if (booking && typeof booking === 'object') {
    const empId = Number(
      (booking.barber as { empId?: unknown } | undefined)?.empId ?? booking.empId,
    );
    const businessDate =
      typeof booking.date === 'string'
        ? booking.date.slice(0, 10)
        : typeof booking.actualDate === 'string'
          ? booking.actualDate.slice(0, 10)
          : null;
    const startAtMs = parseMs(booking.startDateTime);
    const endAtMs = parseMs(booking.endDateTime);
    const branchCode =
      typeof (booking.branch as { branchCode?: unknown } | undefined)?.branchCode === 'string'
        ? String((booking.branch as { branchCode: string }).branchCode)
        : undefined;

    if (Number.isFinite(empId) && empId > 0 && businessDate && startAtMs != null && endAtMs != null) {
      return {
        employeeId: empId,
        branchCode,
        businessDate,
        startAtMs,
        endAtMs,
      };
    }
  }

  const slot = args.fallbackSlot;
  if (!slot) return null;
  const startAtMs = parseMs(slot.startAt);
  const endAtMs = parseMs(slot.endAt);
  if (!Number.isFinite(slot.empId) || slot.empId <= 0 || !slot.businessDate) return null;
  if (startAtMs == null || endAtMs == null || endAtMs <= startAtMs) return null;

  return {
    employeeId: slot.empId,
    branchCode: slot.branchCode ?? undefined,
    businessDate: slot.businessDate.slice(0, 10),
    startAtMs,
    endAtMs,
  };
}

export function resolveRescheduleIntervals(args: {
  oldStartAt: string;
  oldEndAt: string;
  newStartAt: string;
  newEndAt: string;
  oldEmpId: number;
  newEmpId: number;
  oldOperationalDate: string;
  newOperationalDate: string;
}): { oldInterval: AvailabilityOccupancyInterval; newInterval: AvailabilityOccupancyInterval } | null {
  const oldStartAtMs = parseMs(args.oldStartAt);
  const oldEndAtMs = parseMs(args.oldEndAt);
  const newStartAtMs = parseMs(args.newStartAt);
  const newEndAtMs = parseMs(args.newEndAt);
  if (
    oldStartAtMs == null ||
    oldEndAtMs == null ||
    newStartAtMs == null ||
    newEndAtMs == null
  ) {
    return null;
  }
  return {
    oldInterval: {
      employeeId: args.oldEmpId,
      businessDate: args.oldOperationalDate.slice(0, 10),
      startAtMs: oldStartAtMs,
      endAtMs: oldEndAtMs,
    },
    newInterval: {
      employeeId: args.newEmpId,
      businessDate: args.newOperationalDate.slice(0, 10),
      startAtMs: newStartAtMs,
      endAtMs: newEndAtMs,
    },
  };
}

/** Queue / hold occupancy from ISO wall times. */
export function intervalFromIsoRange(args: {
  employeeId: number;
  businessDate: string;
  startIso: string;
  endIso: string;
  branchCode?: string;
}): AvailabilityOccupancyInterval | null {
  const startAtMs = parseMs(args.startIso);
  const endAtMs = parseMs(args.endIso);
  if (startAtMs == null || endAtMs == null || endAtMs <= startAtMs) return null;
  return {
    employeeId: args.employeeId,
    businessDate: args.businessDate.slice(0, 10),
    startAtMs,
    endAtMs,
    branchCode: args.branchCode,
  };
}

/** Timeline overlap on a V2 day cell (48h business-day projection). */
export function computeTimelineOverlapMinutes(args: {
  businessDayStartAtMs: number;
  timelineEndAtMs: number;
  startAtMs: number;
  endAtMs: number;
}): { startMin: number; endMin: number } | null {
  const windowStart =
    args.businessDayStartAtMs > 0
      ? args.businessDayStartAtMs
      : null;
  const windowEnd = args.timelineEndAtMs > 0 ? args.timelineEndAtMs : null;

  if (windowStart == null || windowEnd == null || windowEnd <= windowStart) {
    return null;
  }

  const overlapStart = Math.max(args.startAtMs, windowStart);
  const overlapEnd = Math.min(args.endAtMs, windowEnd);
  if (overlapEnd <= overlapStart) return null;

  const startMin = Math.floor((overlapStart - windowStart) / 60_000);
  const endMin = Math.ceil((overlapEnd - windowStart) / 60_000);
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

/** Fallback day window when DTO lacks businessDayStartAtMs (tests / legacy rows). */
export function fallbackDayWindowMs(
  businessDate: string,
  timezone = V2_SLOT_TZ,
): { startMs: number; endMs: number } {
  const startMs = salonWallToEpochMs(businessDate, '00:00', timezone);
  return { startMs, endMs: startMs + 48 * 60 * 60_000 };
}
