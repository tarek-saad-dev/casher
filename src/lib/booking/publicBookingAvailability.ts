/**
 * Booking Phase 4 — public available-days / available-slots / calendar enrichment.
 */
import 'server-only';
import {
  PublicBookingBranchContextError,
  resolvePublicBookingBranchContext,
  type PublicBookingBranchContext,
} from '@/lib/booking/publicBookingBranchContext';
import {
  BookingServiceDurationError,
  resolveSelectedBookingServices,
  type ResolvedSelectedBookingServices,
} from '@/lib/booking/bookingServiceDuration';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';
import {
  MAX_PUBLIC_BARBER_CALENDAR_DAYS,
  eachDateInclusive,
  inclusiveDaySpan,
  isOutsideBookingHorizon,
} from '@/lib/booking/publicBookingBarberPolicy';
import {
  PUBLIC_AVAILABLE_SLOTS_LIMIT,
  PUBLIC_OVERNIGHT_SLOTS_LIMIT,
  listAvailableBookingSlots,
} from '@/lib/bookingAvailabilityEngine';
import { resolveEmployeeGlobalSchedule } from '@/lib/hr/employeeBranchScheduleResolver';
import { getPublicSettings, isValidDate } from '@/lib/publicBookingHelpers';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { isEmployeeHiddenFromPublicBooking } from '@/lib/hr/testEmployeePolicy';
import { getPool, sql } from '@/lib/db';
import { canBranchAppearInPublicBooking } from '@/lib/branch/publicBranchVisibility';

const CACHE_TTL_MS = 8_000;
const CACHE_MAX = 48;
const cacheRoot = '__pos_public_booking_availability_v4';
const CONTRACT = 'v4';

type CacheEntry = { expiresAt: number; value: unknown };

function cacheMap(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & { [cacheRoot]?: Map<string, CacheEntry> };
  if (!g[cacheRoot]) g[cacheRoot] = new Map();
  return g[cacheRoot]!;
}

export function invalidatePublicBookingAvailabilityCache(): void {
  cacheMap().clear();
  // Phase 10C — cross-branch availability shares create/cancel invalidation.
  void import('@/lib/booking/publicBookingCrossBranchAvailability').then((m) => {
    m.invalidatePublicBookingCrossBranchAvailabilityCache();
  });
}

function cacheGet<T>(key: string): T | null {
  const hit = cacheMap().get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  const map = cacheMap();
  if (map.size >= CACHE_MAX) {
    const first = map.keys().next().value;
    if (first) map.delete(first);
  }
  map.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

export class PublicBookingAvailabilityError extends Error {
  readonly code: PublicBookingErrorCode;
  constructor(code: PublicBookingErrorCode) {
    super(code);
    this.name = 'PublicBookingAvailabilityError';
    this.code = code;
  }
}

export type PublicDayStatus =
  | 'available'
  | 'fully_booked'
  | 'barber_day_off'
  | 'global_leave'
  | 'branch_closed'
  | 'not_assigned'
  | 'service_not_available'
  | 'outside_booking_horizon'
  | 'min_notice_not_met'
  | 'no_eligible_barber'
  | 'barber_at_different_branch'
  | 'not_available_publicly';

export type PublicAvailabilityMode = 'specific_barber' | 'any_barber';

export type PublicSlotWire = {
  time: string;
  dayOffset: 0 | 1;
  startDateTime?: string;
  endDateTime?: string;
  barbers: Array<{ empId: number; nameAr: string }>;
};

export type PublicAvailableSlotsResponse = {
  ok: true;
  branch: { branchCode: string; branchName: string };
  date: string;
  mode: PublicAvailabilityMode;
  services: {
    serviceIds: number[];
    totalDurationMinutes: number;
    totalPrice: number;
  };
  slots: PublicSlotWire[];
  meta: {
    slotCount: number;
    eligibleBarberCount?: number;
    contractVersion: string;
    generatedAt: string;
  };
};

export type PublicAvailableDayWire = {
  date: string;
  status: PublicDayStatus;
  isAvailable: boolean;
  availableSlotCount: number;
  firstAvailableTime: string | null;
  firstAvailableDayOffset: 0 | 1 | null;
  eligibleBarberCount?: number;
  availableBarberCount?: number;
  otherBranch?: { branchCode: string; branchName: string };
};

export type PublicAvailableDaysResponse = {
  ok: true;
  branch: { branchCode: string; branchName: string };
  selection: {
    empId: number | null;
    serviceIds: number[];
    totalDurationMinutes: number;
    mode: PublicAvailabilityMode;
  };
  days: PublicAvailableDayWire[];
  meta: {
    dayCount: number;
    generatedAt: string;
    contractVersion: string;
  };
};

function mapDurationError(err: BookingServiceDurationError): PublicBookingErrorCode {
  if (err.code === 'SERVICES_NOT_CONFIGURED') return 'SERVICES_NOT_CONFIGURED';
  return 'SERVICE_NOT_AVAILABLE_AT_BRANCH';
}

async function resolvePublicBranch(
  branchCode: string | null | undefined,
  previewQueryParam?: string | null,
): Promise<PublicBookingBranchContext> {
  if (!branchCode) throw new PublicBookingAvailabilityError('BRANCH_REQUIRED');
  try {
    const ctx = await resolvePublicBookingBranchContext({
      branchCode,
      purpose: 'public_booking',
      previewQueryParam,
    });
    if (!ctx.bookingEnabled || !ctx.publicBookingEnabled) {
      throw new PublicBookingAvailabilityError('BRANCH_BOOKING_DISABLED');
    }
    return ctx;
  } catch (err) {
    if (err instanceof PublicBookingAvailabilityError) throw err;
    if (err instanceof PublicBookingBranchContextError) {
      throw new PublicBookingAvailabilityError(err.code);
    }
    throw err;
  }
}

async function loadEmpName(empId: number): Promise<string | null> {
  const db = await getPool();
  const r = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`SELECT EmpName, ISNULL(isActive,1) AS isActive FROM dbo.TblEmp WHERE EmpID=@empId`);
  const row = r.recordset[0];
  if (!row || !row.isActive) return null;
  if (isEmployeeHiddenFromPublicBooking(row.EmpName)) return null;
  return String(row.EmpName);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mergeCandidateSlots(
  plans: Array<{
    time: string;
    dayOffset: 0 | 1;
    startAt: string;
    endAt: string;
    empId: number;
    empName: string;
    available: boolean;
  }>,
  limit: number,
): PublicSlotWire[] {
  const map = new Map<string, PublicSlotWire>();
  for (const p of plans) {
    if (!p.available) continue;
    const key = `${p.dayOffset}|${p.time}`;
    let slot = map.get(key);
    if (!slot) {
      slot = {
        time: p.time,
        dayOffset: p.dayOffset,
        startDateTime: p.startAt,
        endDateTime: p.endAt,
        barbers: [],
      };
      map.set(key, slot);
    }
    if (!slot.barbers.some((b) => b.empId === p.empId)) {
      slot.barbers.push({ empId: p.empId, nameAr: p.empName });
    }
  }
  const sorted = [...map.values()].sort((a, b) =>
    a.dayOffset !== b.dayOffset
      ? a.dayOffset - b.dayOffset
      : a.time.localeCompare(b.time),
  );
  return sorted.slice(0, limit);
}

async function classifySpecificBarberDay(args: {
  empId: number;
  branchCtx: PublicBookingBranchContext;
  date: string;
  horizonEnd: string;
}): Promise<PublicDayStatus | null> {
  if (isOutsideBookingHorizon(args.date, args.horizonEnd)) {
    return 'outside_booking_horizon';
  }
  const global = await resolveEmployeeGlobalSchedule({
    empId: args.empId,
    workDate: args.date,
    publicOnly: false,
  });
  if (global.isGlobalDayOff) return 'global_leave';

  const publicWorking = (
    await resolveEmployeeGlobalSchedule({
      empId: args.empId,
      workDate: args.date,
      publicOnly: true,
    })
  ).branches.filter((b) => b.isWorking);

  const atBranch = publicWorking.find((b) => b.branchId === args.branchCtx.branchId);
  if (atBranch) return null; // proceed to slot calc

  const otherPublic = publicWorking[0];
  if (otherPublic) return 'barber_at_different_branch';

  const privateWorking = global.branches.filter((b) => b.isWorking);
  if (privateWorking.length) {
    const dest = privateWorking[0];
    if (await canBranchAppearInPublicBooking(dest.branchId)) {
      return 'barber_at_different_branch';
    }
    return 'not_available_publicly';
  }
  return 'barber_day_off';
}

export async function getPublicAvailableSlots(args: {
  branchCode?: string | null;
  date: string;
  serviceIds: string | number[];
  empId?: number | null;
  previewQueryParam?: string | null;
}): Promise<PublicAvailableSlotsResponse> {
  if (!isValidDate(args.date)) {
    throw new PublicBookingAvailabilityError('INVALID_DATE');
  }
  const branchCtx = await resolvePublicBranch(args.branchCode, args.previewQueryParam);

  let selected: ResolvedSelectedBookingServices;
  try {
    selected = await resolveSelectedBookingServices({
      branchContext: branchCtx,
      serviceIds: args.serviceIds,
    });
  } catch (err) {
    if (err instanceof BookingServiceDurationError) {
      throw new PublicBookingAvailabilityError(mapDurationError(err));
    }
    throw err;
  }

  const empId =
    args.empId != null && Number.isFinite(Number(args.empId)) && Number(args.empId) > 0
      ? Number(args.empId)
      : null;
  const mode: PublicAvailabilityMode = empId ? 'specific_barber' : 'any_barber';

  if (empId) {
    const name = await loadEmpName(empId);
    if (!name) throw new PublicBookingAvailabilityError('BARBER_NOT_FOUND');
    const dayStatus = await classifySpecificBarberDay({
      empId,
      branchCtx,
      date: args.date,
      horizonEnd: addDaysYmd(
        getCairoBusinessDate(),
        (await getPublicSettings(branchCtx.branchId)).maxBookingDaysAhead,
      ),
    });
    if (dayStatus === 'global_leave') {
      throw new PublicBookingAvailabilityError('BARBER_DAY_OFF');
    }
    if (dayStatus === 'barber_at_different_branch') {
      throw new PublicBookingAvailabilityError('BARBER_AVAILABLE_AT_DIFFERENT_BRANCH');
    }
    if (dayStatus === 'not_available_publicly' || dayStatus === 'barber_day_off') {
      return {
        ok: true,
        branch: { branchCode: branchCtx.branchCode, branchName: branchCtx.branchName },
        date: args.date,
        mode,
        services: {
          serviceIds: selected.serviceIds,
          totalDurationMinutes: selected.totalDurationMinutes,
          totalPrice: selected.totalPrice,
        },
        slots: [],
        meta: {
          slotCount: 0,
          contractVersion: CONTRACT,
          generatedAt: new Date().toISOString(),
        },
      };
    }
  }

  const cacheKey = [
    'slots',
    branchCtx.branchCode,
    args.date,
    mode,
    empId ?? 'ANY',
    selected.serviceIds.join(','),
    selected.totalDurationMinutes,
    CONTRACT,
  ].join('::');
  const cached = cacheGet<PublicAvailableSlotsResponse>(cacheKey);
  if (cached) return cached;

  const engine = await listAvailableBookingSlots({
    date: args.date,
    serviceIds: selected.serviceIds,
    mode: empId ? 'specific' : 'nearest',
    empId,
    branchId: branchCtx.branchId,
    source: 'public',
    durationOverride: selected.totalDurationMinutes,
    collectAllCandidates: !empId,
  });

  const hasOvernight = engine.availableSlots.some((s) => s.dayOffset === 1);
  const limit = hasOvernight ? PUBLIC_OVERNIGHT_SLOTS_LIMIT : PUBLIC_AVAILABLE_SLOTS_LIMIT;
  const slots = mergeCandidateSlots(engine.availableSlots, limit);
  const eligibleBarberCount = Number(engine.debug.barberCount ?? 0);

  if (!empId && eligibleBarberCount === 0) {
    throw new PublicBookingAvailabilityError('NO_ELIGIBLE_BARBER');
  }

  const response: PublicAvailableSlotsResponse = {
    ok: true,
    branch: { branchCode: branchCtx.branchCode, branchName: branchCtx.branchName },
    date: args.date,
    mode,
    services: {
      serviceIds: selected.serviceIds,
      totalDurationMinutes: selected.totalDurationMinutes,
      totalPrice: selected.totalPrice,
    },
    slots,
    meta: {
      slotCount: slots.length,
      ...(empId ? {} : { eligibleBarberCount }),
      contractVersion: CONTRACT,
      generatedAt: new Date().toISOString(),
    },
  };
  cacheSet(cacheKey, response);
  return response;
}

type PreloadedSlotsSnapshot = {
  slots: PublicSlotWire[];
  slotCount: number;
  eligibleBarberCount?: number;
};

/** Phase 7C2 — list slots using pre-resolved branch/services (avoids per-day catalog reload). */
async function listSlotsForPreloadedContext(args: {
  branchCtx: PublicBookingBranchContext;
  selected: ResolvedSelectedBookingServices;
  date: string;
  empId: number | null;
}): Promise<PreloadedSlotsSnapshot | null> {
  const cacheKey = [
    'slots-pre',
    args.branchCtx.branchCode,
    args.date,
    args.empId ?? 'ANY',
    args.selected.serviceIds.join(','),
    args.selected.totalDurationMinutes,
    CONTRACT,
  ].join('::');
  const cached = cacheGet<PreloadedSlotsSnapshot>(cacheKey);
  if (cached) return cached;

  const engine = await listAvailableBookingSlots({
    date: args.date,
    serviceIds: args.selected.serviceIds,
    mode: args.empId ? 'specific' : 'nearest',
    empId: args.empId,
    branchId: args.branchCtx.branchId,
    source: 'public',
    durationOverride: args.selected.totalDurationMinutes,
    collectAllCandidates: !args.empId,
  });

  const hasOvernight = engine.availableSlots.some((s) => s.dayOffset === 1);
  const limit = hasOvernight ? PUBLIC_OVERNIGHT_SLOTS_LIMIT : PUBLIC_AVAILABLE_SLOTS_LIMIT;
  const slots = mergeCandidateSlots(engine.availableSlots, limit);
  const eligibleBarberCount = Number(engine.debug.barberCount ?? 0);

  if (!args.empId && eligibleBarberCount === 0) {
    return null;
  }

  const snapshot: PreloadedSlotsSnapshot = {
    slots,
    slotCount: slots.length,
    ...(args.empId ? {} : { eligibleBarberCount }),
  };
  cacheSet(cacheKey, snapshot);
  return snapshot;
}

async function buildAvailableDayWire(args: {
  date: string;
  branchCtx: PublicBookingBranchContext;
  selected: ResolvedSelectedBookingServices;
  empId: number | null;
  horizonEnd: string;
}): Promise<PublicAvailableDayWire> {
  const { date, branchCtx, selected, empId, horizonEnd } = args;

  if (isOutsideBookingHorizon(date, horizonEnd)) {
    return {
      date,
      status: 'outside_booking_horizon',
      isAvailable: false,
      availableSlotCount: 0,
      firstAvailableTime: null,
      firstAvailableDayOffset: null,
    };
  }

  if (empId) {
    const pre = await classifySpecificBarberDay({
      empId,
      branchCtx,
      date,
      horizonEnd,
    });
    if (pre === 'barber_at_different_branch') {
      const g = await resolveEmployeeGlobalSchedule({
        empId,
        workDate: date,
        publicOnly: true,
      });
      const other = g.branches.find((b) => b.isWorking && b.branchId !== branchCtx.branchId);
      return {
        date,
        status: 'barber_at_different_branch',
        isAvailable: false,
        availableSlotCount: 0,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
        ...(other
          ? { otherBranch: { branchCode: other.branchCode, branchName: other.branchName } }
          : {}),
      };
    }
    if (pre && pre !== null) {
      return {
        date,
        status: pre,
        isAvailable: false,
        availableSlotCount: 0,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
      };
    }
  }

  const slots = await listSlotsForPreloadedContext({
    branchCtx,
    selected,
    date,
    empId,
  }).catch((err) => {
    if (err instanceof PublicBookingAvailabilityError && err.code === 'NO_ELIGIBLE_BARBER') {
      return null;
    }
    if (
      err instanceof PublicBookingAvailabilityError &&
      (err.code === 'BARBER_DAY_OFF' || err.code === 'BARBER_AVAILABLE_AT_DIFFERENT_BRANCH')
    ) {
      return null;
    }
    throw err;
  });

  if (!slots) {
    return {
      date,
      status: empId ? 'barber_day_off' : 'no_eligible_barber',
      isAvailable: false,
      availableSlotCount: 0,
      firstAvailableTime: null,
      firstAvailableDayOffset: null,
      ...(empId ? {} : { eligibleBarberCount: 0, availableBarberCount: 0 }),
    };
  }

  const availableBarberIds = new Set(slots.slots.flatMap((s) => s.barbers.map((b) => b.empId)));
  const first = slots.slots[0] ?? null;
  const isAvailable = slots.slots.length > 0;
  return {
    date,
    status: isAvailable ? 'available' : 'fully_booked',
    isAvailable,
    availableSlotCount: slots.slotCount,
    firstAvailableTime: first?.time ?? null,
    firstAvailableDayOffset: first?.dayOffset ?? null,
    ...(empId
      ? {}
      : {
          eligibleBarberCount: slots.eligibleBarberCount ?? 0,
          availableBarberCount: availableBarberIds.size,
        }),
  };
}

export async function getPublicAvailableDays(args: {
  branchCode?: string | null;
  serviceIds: string | number[];
  empId?: number | null;
  from?: string | null;
  to?: string | null;
  previewQueryParam?: string | null;
}): Promise<PublicAvailableDaysResponse> {
  const branchCtx = await resolvePublicBranch(args.branchCode, args.previewQueryParam);
  const settings = await getPublicSettings(branchCtx.branchId);
  const today = getCairoBusinessDate();
  const from = args.from && isValidDate(args.from) ? args.from : today;
  const to =
    args.to && isValidDate(args.to)
      ? args.to
      : addDaysYmd(today, Math.min(settings.maxBookingDaysAhead, 14));

  if (!isValidDate(from) || !isValidDate(to)) {
    throw new PublicBookingAvailabilityError('INVALID_DATE');
  }
  if (from > to) throw new PublicBookingAvailabilityError('INVALID_DATE_RANGE');
  const span = inclusiveDaySpan(from, to);
  if (span < 0 || span > MAX_PUBLIC_BARBER_CALENDAR_DAYS) {
    throw new PublicBookingAvailabilityError('DATE_RANGE_TOO_LARGE');
  }

  let selected: ResolvedSelectedBookingServices;
  try {
    selected = await resolveSelectedBookingServices({
      branchContext: branchCtx,
      serviceIds: args.serviceIds,
    });
  } catch (err) {
    if (err instanceof BookingServiceDurationError) {
      throw new PublicBookingAvailabilityError(mapDurationError(err));
    }
    throw err;
  }

  const empId =
    args.empId != null && Number.isFinite(Number(args.empId)) && Number(args.empId) > 0
      ? Number(args.empId)
      : null;
  if (empId) {
    const name = await loadEmpName(empId);
    if (!name) throw new PublicBookingAvailabilityError('BARBER_NOT_FOUND');
  }

  const mode: PublicAvailabilityMode = empId ? 'specific_barber' : 'any_barber';
  const horizonEnd = addDaysYmd(today, settings.maxBookingDaysAhead);

  const cacheKey = [
    'days',
    branchCtx.branchCode,
    from,
    to,
    mode,
    empId ?? 'ANY',
    selected.serviceIds.join(','),
    selected.totalDurationMinutes,
    CONTRACT,
  ].join('::');
  const cached = cacheGet<PublicAvailableDaysResponse>(cacheKey);
  if (cached) return cached;

  const dateRange = eachDateInclusive(from, to);
  const days = await Promise.all(
    dateRange.map((date) =>
      buildAvailableDayWire({
        date,
        branchCtx,
        selected,
        empId,
        horizonEnd,
      }),
    ),
  );

  const response: PublicAvailableDaysResponse = {
    ok: true,
    branch: { branchCode: branchCtx.branchCode, branchName: branchCtx.branchName },
    selection: {
      empId,
      serviceIds: selected.serviceIds,
      totalDurationMinutes: selected.totalDurationMinutes,
      mode,
    },
    days,
    meta: {
      dayCount: days.length,
      generatedAt: new Date().toISOString(),
      contractVersion: CONTRACT,
    },
  };
  cacheSet(cacheKey, response);
  return response;
}

/** Enrich a calendar day with real slot availability when serviceIds present. */
export async function enrichCalendarDayAvailability(args: {
  branchCode: string;
  empId: number;
  date: string;
  serviceIds: number[];
  baseStatus: string;
  isWorking: boolean;
}): Promise<{
  status: string;
  availableSlotCount: number;
  firstAvailableTime: string | null;
  firstAvailableDayOffset: 0 | 1 | null;
  isBookableCandidate: boolean;
}> {
  if (!args.serviceIds.length || !args.isWorking) {
    return {
      status: args.baseStatus,
      availableSlotCount: 0,
      firstAvailableTime: null,
      firstAvailableDayOffset: null,
      isBookableCandidate: args.isWorking && args.baseStatus === 'presence_only',
    };
  }
  try {
    const slots = await getPublicAvailableSlots({
      branchCode: args.branchCode,
      date: args.date,
      serviceIds: args.serviceIds,
      empId: args.empId,
    });
    const first = slots.slots[0] ?? null;
    const available = slots.slots.length > 0;
    return {
      status: available ? 'available' : 'fully_booked',
      availableSlotCount: slots.meta.slotCount,
      firstAvailableTime: first?.time ?? null,
      firstAvailableDayOffset: first?.dayOffset ?? null,
      isBookableCandidate: available,
    };
  } catch (err) {
    if (err instanceof PublicBookingAvailabilityError) {
      if (err.code === 'SERVICE_NOT_AVAILABLE_AT_BRANCH') {
        return {
          status: 'service_not_available',
          availableSlotCount: 0,
          firstAvailableTime: null,
          firstAvailableDayOffset: null,
          isBookableCandidate: false,
        };
      }
    }
    return {
      status: args.baseStatus,
      availableSlotCount: 0,
      firstAvailableTime: null,
      firstAvailableDayOffset: null,
      isBookableCandidate: false,
    };
  }
}
