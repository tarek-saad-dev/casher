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
  listAvailableBookingSlots,
} from '@/lib/bookingAvailabilityEngine';
import { summarizeAvailableDaysRange } from '@/lib/booking/publicAvailableDaysRange';
import { resolveEmployeeGlobalSchedule } from '@/lib/hr/employeeBranchScheduleResolver';
import { getPublicSettings, isValidDate } from '@/lib/publicBookingHelpers';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { isEmployeeHiddenFromPublicBooking } from '@/lib/hr/testEmployeePolicy';
import { getPool, sql } from '@/lib/db';
import { canBranchAppearInPublicBooking } from '@/lib/branch/publicBranchVisibility';

const CACHE_TTL_MS = 45_000;
/** Calendar days change less often than live slots — keep longer. */
const DAYS_CACHE_TTL_MS = 90_000;
const CACHE_MAX = 64;
const cacheRoot = '__pos_public_booking_availability_v7';
const CONTRACT = 'v7';
/** available-days only needs first free time for calendar highlighting. */
const DAYS_SUMMARY_SLOT_CAP = 1;

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
  // Phase 1C — multi-branch barber days/slots.
  void import('@/lib/booking/publicBarberMultiBranchAvailability').then((m) => {
    m.invalidatePublicBarberMultiBranchAvailabilityCache();
  });
}

function cacheGet<T>(key: string): T | null {
  const hit = cacheMap().get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.value as T;
}

function cacheSet(key: string, value: unknown, ttlMs: number = CACHE_TTL_MS): void {
  const map = cacheMap();
  if (map.size >= CACHE_MAX) {
    const first = map.keys().next().value;
    if (first) map.delete(first);
  }
  map.set(key, { expiresAt: Date.now() + ttlMs, value });
}

/** Bound parallel day fan-out so available-days does not thrash the SQL pool. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
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
  /** Present when slots are empty — machine-readable (Phase 1C). */
  reasonCode?: string | null;
  message?: string | null;
  messageAr?: string | null;
  recoverySuggestionAr?: string | null;
  employeeReasons?: Array<{ empId: number; reasonCode: string; message?: string }>;
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
  limit?: number | null,
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
  if (limit != null && limit > 0 && Number.isFinite(limit)) {
    return sorted.slice(0, limit);
  }
  return sorted;
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

  // Single public schedule resolve (was 2× global + private fan-out before).
  const publicGlobal = await resolveEmployeeGlobalSchedule({
    empId: args.empId,
    workDate: args.date,
    publicOnly: true,
  });
  if (publicGlobal.isGlobalDayOff) return 'global_leave';

  const publicWorking = publicGlobal.branches.filter((b) => b.isWorking);
  const atBranch = publicWorking.find((b) => b.branchId === args.branchCtx.branchId);
  if (atBranch) return null; // proceed to slot calc

  if (publicWorking[0]) return 'barber_at_different_branch';

  // Not on any public branch — one private resolve to distinguish hidden vs day off.
  const privateGlobal = await resolveEmployeeGlobalSchedule({
    empId: args.empId,
    workDate: args.date,
    publicOnly: false,
  });
  if (privateGlobal.isGlobalDayOff) return 'global_leave';

  const privateWorking = privateGlobal.branches.filter((b) => b.isWorking);
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
  /** Stable canary key (client/session). Deterministic Legacy/V2 sticky assignment. */
  canaryKey?: string | null;
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

  const {
    resolveBookingV2ReadDecision,
    recordBookingV2ReadMetric,
    logBookingV2ReadFallback,
    isBookingV2TechnicalFailure,
  } = await import('@/lib/booking/projection/bookingV2ReadCutover');
  const decision = resolveBookingV2ReadDecision({ canaryKey: args.canaryKey });

  // Cache BEFORE schedule work — include engine so V2/legacy never collide.
  const cacheKey = [
    'slots',
    decision.serveV2 ? 'v2' : 'legacy',
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

  if (empId) {
    const name = await loadEmpName(empId);
    if (!name) throw new PublicBookingAvailabilityError('BARBER_NOT_FOUND');
  }

  const settings = await getPublicSettings(branchCtx.branchId);

  // --- B7B: staged V2 read (same public contract) ---
  if (decision.serveV2) {
    try {
      const {
        resolveV2PublicSlots,
        buildSlotsResponseForBranch,
      } = await import('@/lib/booking/projection/bookingV2PublicReadAdapter');
      const v2 = await resolveV2PublicSlots({
        branchCtx,
        selected,
        date: args.date,
        empId,
        minNoticeMinutes: settings.minNoticeMinutes,
      });

      if (!empId && v2.eligibleBarberCount === 0) {
        throw new PublicBookingAvailabilityError('NO_ELIGIBLE_BARBER');
      }

      if (empId && v2.slots.length === 0) {
        const dayStatus = await classifySpecificBarberDay({
          empId,
          branchCtx,
          date: args.date,
          horizonEnd: addDaysYmd(getCairoBusinessDate(), settings.maxBookingDaysAhead),
        });
        if (dayStatus === 'global_leave') {
          throw new PublicBookingAvailabilityError('BARBER_DAY_OFF');
        }
        if (dayStatus === 'barber_at_different_branch') {
          throw new PublicBookingAvailabilityError('BARBER_AVAILABLE_AT_DIFFERENT_BRANCH');
        }
        if (dayStatus === 'outside_booking_horizon') {
          throw new PublicBookingAvailabilityError('BOOKING_HORIZON_EXCEEDED');
        }
      }

      let response = buildSlotsResponseForBranch({
        branchCtx,
        selected,
        date: args.date,
        empId,
        slots: v2.slots,
        eligibleBarberCount: v2.eligibleBarberCount,
      });

      if (v2.slots.length === 0) {
        const { logEmptySlotsMetric } = await import(
          '@/lib/availability/bookingAvailabilityMetrics'
        );
        const { buildEmptySlotsUx } = await import('@/lib/availability/emptySlotsUx');
        const ux = buildEmptySlotsUx('SLOT_UNAVAILABLE');
        logEmptySlotsMetric({
          reasonCode: 'SLOT_UNAVAILABLE',
          branchCode: branchCtx.branchCode,
          branchId: branchCtx.branchId,
          empId: empId ?? null,
          businessDate: args.date,
          source: 'public_available_slots_v2',
        });
        response = {
          ...response,
          reasonCode: ux.reasonCode,
          message: ux.messageAr,
          messageAr: ux.messageAr,
          recoverySuggestionAr: ux.recoverySuggestionAr,
        };
      }

      cacheSet(
        cacheKey,
        response,
        args.date > getCairoBusinessDate() ? DAYS_CACHE_TTL_MS : CACHE_TTL_MS,
      );
      recordBookingV2ReadMetric({
        engine: 'v2',
        ok: true,
        totalMs: v2.totalMs,
        dbMs: v2.dbMs,
        queryCount: v2.queryCount,
        composeMs: v2.composeMs,
        slotCount: v2.slots.length,
      });

      if (decision.reverseShadow) {
        schedulePublicReverseSlotsShadow({
          branchId: branchCtx.branchId,
          date: args.date,
          empId,
          durationMinutes: selected.totalDurationMinutes,
          serviceIds: selected.serviceIds,
          minNoticeMinutes: settings.minNoticeMinutes,
          slots: response.slots,
          v2Ms: v2.totalMs,
        });
      }
      return response;
    } catch (err) {
      if (!isBookingV2TechnicalFailure(err)) throw err;
      logBookingV2ReadFallback({
        surface: 'available-slots',
        error: err instanceof Error ? err.message : 'error',
        branchId: branchCtx.branchId,
        businessDate: args.date,
        canaryKey: decision.canaryKey,
      });
      recordBookingV2ReadMetric({
        engine: 'v2',
        ok: false,
        fallback: true,
      });
      // fall through to legacy
    }
  }

  const legacyT0 = performance.now();
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
  const legacyMs = performance.now() - legacyT0;

  const slots = mergeCandidateSlots(engine.availableSlots);
  const eligibleBarberCount = Number(engine.debug.barberCount ?? 0);

  if (!empId && eligibleBarberCount === 0) {
    throw new PublicBookingAvailabilityError('NO_ELIGIBLE_BARBER');
  }

  // Empty specific-barber result: classify location only then (happy path skips this).
  if (empId && slots.length === 0) {
    const dayStatus = await classifySpecificBarberDay({
      empId,
      branchCtx,
      date: args.date,
      horizonEnd: addDaysYmd(getCairoBusinessDate(), settings.maxBookingDaysAhead),
    });
    if (dayStatus === 'global_leave') {
      throw new PublicBookingAvailabilityError('BARBER_DAY_OFF');
    }
    if (dayStatus === 'barber_at_different_branch') {
      throw new PublicBookingAvailabilityError('BARBER_AVAILABLE_AT_DIFFERENT_BRANCH');
    }
    if (dayStatus === 'outside_booking_horizon') {
      throw new PublicBookingAvailabilityError('BOOKING_HORIZON_EXCEEDED');
    }
    // barber_day_off / not_available_publicly → empty slots envelope below
  }

  const emptyReason = engine.reasonCode ?? 'SLOT_UNAVAILABLE';
  if (slots.length === 0) {
    const { logEmptySlotsMetric } = await import(
      '@/lib/availability/bookingAvailabilityMetrics'
    );
    const { buildEmptySlotsUx } = await import('@/lib/availability/emptySlotsUx');
    const ux = buildEmptySlotsUx(emptyReason);
    logEmptySlotsMetric({
      reasonCode: emptyReason,
      branchCode: branchCtx.branchCode,
      branchId: branchCtx.branchId,
      empId: empId ?? null,
      businessDate: args.date,
      source: 'public_available_slots',
    });
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
      reasonCode: ux.reasonCode,
      message: engine.noSlotsReason ?? ux.messageAr,
      messageAr: ux.messageAr,
      recoverySuggestionAr: ux.recoverySuggestionAr,
      employeeReasons: engine.employeeReasons,
      meta: {
        slotCount: 0,
        ...(empId ? {} : { eligibleBarberCount }),
        contractVersion: CONTRACT,
        generatedAt: new Date().toISOString(),
      },
    };
    cacheSet(
      cacheKey,
      response,
      args.date > getCairoBusinessDate() ? DAYS_CACHE_TTL_MS : CACHE_TTL_MS,
    );
    recordBookingV2ReadMetric({
      engine: 'legacy',
      ok: true,
      totalMs: legacyMs,
      slotCount: 0,
    });
    if (decision.forwardShadow) {
      const shadowEmpIds =
        empId != null
          ? [empId]
          : [
              ...new Set(
                (Array.isArray(engine.debug?.candidateEmpIds)
                  ? (engine.debug.candidateEmpIds as number[])
                  : []
                ).concat(
                  (engine.employeeReasons ?? []).map((r) => Number(r.empId)).filter((id) => id > 0),
                ),
              ),
            ];
      schedulePublicSlotsShadow({
        branchId: branchCtx.branchId,
        date: args.date,
        empId,
        durationMinutes: selected.totalDurationMinutes,
        slots,
        candidateEmpIds: shadowEmpIds,
        minNoticeMinutes: settings.minNoticeMinutes,
        legacyMs,
      });
    }
    return response;
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
  cacheSet(
    cacheKey,
    response,
    args.date > getCairoBusinessDate() ? DAYS_CACHE_TTL_MS : CACHE_TTL_MS,
  );
  recordBookingV2ReadMetric({
    engine: 'legacy',
    ok: true,
    totalMs: legacyMs,
    slotCount: slots.length,
  });
  if (decision.forwardShadow) {
    schedulePublicSlotsShadow({
      branchId: branchCtx.branchId,
      date: args.date,
      empId,
      durationMinutes: selected.totalDurationMinutes,
      slots,
      candidateEmpIds: [
        ...new Set(
          slots.flatMap((s) => s.barbers.map((b) => b.empId)).concat(empId ? [empId] : []),
        ),
      ],
      minNoticeMinutes: settings.minNoticeMinutes,
      legacyMs,
    });
  }
  return response;
}

function schedulePublicSlotsShadow(args: {
  branchId: number;
  date: string;
  empId: number | null;
  durationMinutes: number;
  slots: PublicSlotWire[];
  candidateEmpIds: number[];
  minNoticeMinutes?: number;
  legacyMs?: number;
}): void {
  void import('@/lib/booking/projection/scheduleAvailabilityShadow')
    .then((m) => {
      m.scheduleAvailabilityShadowParity({
        branchId: args.branchId,
        businessDate: args.date,
        employeeId: args.empId,
        employeeIds: args.candidateEmpIds,
        durationMinutes: args.durationMinutes,
        minNoticeMinutes: args.minNoticeMinutes,
        legacyMs: args.legacyMs,
        legacySlots: args.slots.map((s) => ({
          time: s.time,
          dayOffset: s.dayOffset,
          candidates: s.barbers.map((b) => ({ empId: b.empId })),
        })),
        source: 'public',
      });
    })
    .catch(() => {
      /* shadow optional */
    });
}

function schedulePublicReverseSlotsShadow(args: {
  branchId: number;
  date: string;
  empId: number | null;
  durationMinutes: number;
  serviceIds: number[];
  minNoticeMinutes?: number;
  slots: PublicSlotWire[];
  v2Ms?: number;
}): void {
  void import('@/lib/booking/projection/scheduleAvailabilityShadow')
    .then((m) => {
      m.scheduleReverseAvailabilityShadowParity({
        branchId: args.branchId,
        businessDate: args.date,
        employeeId: args.empId,
        durationMinutes: args.durationMinutes,
        serviceIds: args.serviceIds,
        minNoticeMinutes: args.minNoticeMinutes,
        v2Ms: args.v2Ms,
        v2Slots: args.slots.map((s) => ({
          time: s.time,
          dayOffset: s.dayOffset,
          candidates: s.barbers.map((b) => ({ empId: b.empId })),
        })),
      });
    })
    .catch(() => {
      /* shadow optional */
    });
}

function schedulePublicAvailableDaysShadow(args: {
  branchId: number;
  empId: number | null;
  employeeIds: number[];
  durationMinutes: number;
  minNoticeMinutes: number;
  days: Array<{ date: string; isAvailable: boolean }>;
  legacyMs?: number;
}): void {
  void import('@/lib/booking/projection/scheduleAvailabilityShadow')
    .then((m) => {
      m.scheduleAvailableDaysShadowParity({
        branchId: args.branchId,
        employeeId: args.empId,
        employeeIds: args.employeeIds,
        durationMinutes: args.durationMinutes,
        minNoticeMinutes: args.minNoticeMinutes,
        days: args.days,
        legacyMs: args.legacyMs,
        source: 'public',
      });
    })
    .catch(() => {
      /* shadow optional */
    });
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
  /** Calendar summary: stop after first free slot. */
  summaryOnly?: boolean;
}): Promise<PreloadedSlotsSnapshot | null> {
  const summaryOnly = !!args.summaryOnly;
  const cacheKey = [
    summaryOnly ? 'slots-pre-summary' : 'slots-pre',
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
    // Calendar only needs "is there any free time" — not every barber at every slot.
    collectAllCandidates: !args.empId && !summaryOnly,
    maxAvailableSlots: summaryOnly ? DAYS_SUMMARY_SLOT_CAP : undefined,
  });

  const slots = mergeCandidateSlots(
    engine.availableSlots,
    summaryOnly ? DAYS_SUMMARY_SLOT_CAP : null,
  );
  const eligibleBarberCount = Number(engine.debug.barberCount ?? 0);

  if (!args.empId && eligibleBarberCount === 0) {
    return null;
  }

  const snapshot: PreloadedSlotsSnapshot = {
    slots,
    slotCount: slots.length,
    ...(args.empId ? {} : { eligibleBarberCount }),
  };
  cacheSet(cacheKey, snapshot, summaryOnly ? DAYS_CACHE_TTL_MS : CACHE_TTL_MS);
  // available-days summary uses maxAvailableSlots=1 — skip shadow there to avoid false extras.
  if (!summaryOnly) {
    const shadowEmpIds =
      args.empId != null
        ? [args.empId]
        : [
            ...new Set(
              (Array.isArray(engine.debug?.candidateEmpIds)
                ? (engine.debug.candidateEmpIds as number[])
                : []
              ).concat(slots.flatMap((s) => s.barbers.map((b) => b.empId))),
            ),
          ];
    schedulePublicSlotsShadow({
      branchId: args.branchCtx.branchId,
      date: args.date,
      empId: args.empId,
      durationMinutes: args.selected.totalDurationMinutes,
      slots,
      candidateEmpIds: shadowEmpIds,
    });
  }
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
    summaryOnly: true,
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
  canaryKey?: string | null;
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

  const {
    resolveBookingV2ReadDecision,
    recordBookingV2ReadMetric,
    logBookingV2ReadFallback,
    isBookingV2TechnicalFailure,
  } = await import('@/lib/booking/projection/bookingV2ReadCutover');
  const decision = resolveBookingV2ReadDecision({ canaryKey: args.canaryKey });

  const cacheKey = [
    'days',
    decision.serveV2 ? 'v2' : 'legacy',
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

  if (decision.serveV2) {
    try {
      const {
        resolveV2PublicAvailableDays,
        buildDaysResponseForBranch,
      } = await import('@/lib/booking/projection/bookingV2PublicReadAdapter');
      const v2 = await resolveV2PublicAvailableDays({
        branchCtx,
        selected,
        empId,
        from,
        to,
        horizonEnd,
        minNoticeMinutes: settings.minNoticeMinutes,
      });
      const response = buildDaysResponseForBranch({
        branchCtx,
        selected,
        empId,
        days: v2.days,
      });
      cacheSet(cacheKey, response, DAYS_CACHE_TTL_MS);
      recordBookingV2ReadMetric({
        engine: 'v2',
        ok: true,
        totalMs: v2.totalMs,
        dbMs: v2.dbMs,
        queryCount: v2.queryCount,
        composeMs: v2.composeMs,
        slotCount: v2.days.filter((d) => d.isAvailable).length,
      });
      // Reverse monitoring for days is covered by reverse slots shadow samples.
      return response;
    } catch (err) {
      if (!isBookingV2TechnicalFailure(err)) throw err;
      logBookingV2ReadFallback({
        surface: 'available-days',
        error: err instanceof Error ? err.message : 'error',
        branchId: branchCtx.branchId,
        canaryKey: decision.canaryKey,
      });
      recordBookingV2ReadMetric({ engine: 'v2', ok: false, fallback: true });
      // fall through
    }
  }

  const dateRange = eachDateInclusive(from, to);
  const probeDates = dateRange.filter((d) => !isOutsideBookingHorizon(d, horizonEnd));

  const legacyT0 = performance.now();
  const probes = await summarizeAvailableDaysRange({
    dates: probeDates,
    branchId: branchCtx.branchId,
    serviceIds: selected.serviceIds,
    durationMinutes: selected.totalDurationMinutes,
    mode: empId ? 'specific' : 'nearest',
    empId,
  });
  const legacyMs = performance.now() - legacyT0;

  const days: PublicAvailableDayWire[] = dateRange.map((date) => {
    if (isOutsideBookingHorizon(date, horizonEnd)) {
      return {
        date,
        status: 'outside_booking_horizon' as const,
        isAvailable: false,
        availableSlotCount: 0,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
      };
    }
    const p = probes.get(date);
    if (!p) {
      return {
        date,
        status: (empId ? 'barber_day_off' : 'no_eligible_barber') as PublicDayStatus,
        isAvailable: false,
        availableSlotCount: 0,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
        ...(empId ? {} : { eligibleBarberCount: 0, availableBarberCount: 0 }),
      };
    }
    if (!empId && p.eligibleBarberCount === 0) {
      return {
        date,
        status: 'no_eligible_barber' as const,
        isAvailable: false,
        availableSlotCount: 0,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
        eligibleBarberCount: 0,
        availableBarberCount: 0,
      };
    }
    if (empId && p.eligibleBarberCount === 0) {
      return {
        date,
        status: 'barber_day_off' as const,
        isAvailable: false,
        availableSlotCount: 0,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
      };
    }
    return {
      date,
      status: (p.available ? 'available' : 'fully_booked') as PublicDayStatus,
      isAvailable: p.available,
      availableSlotCount: p.available ? 1 : 0,
      firstAvailableTime: p.firstAvailableTime,
      firstAvailableDayOffset: p.firstAvailableDayOffset,
      ...(empId
        ? {}
        : {
            eligibleBarberCount: p.eligibleBarberCount,
            availableBarberCount: p.availableBarberCount,
          }),
    };
  });

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
  cacheSet(cacheKey, response, DAYS_CACHE_TTL_MS);

  const {
    recordBookingV2ReadMetric: recordLegacyDaysMetric,
  } = await import('@/lib/booking/projection/bookingV2ReadCutover');
  recordLegacyDaysMetric({
    engine: 'legacy',
    ok: true,
    totalMs: legacyMs,
    slotCount: days.filter((d) => d.isAvailable).length,
  });

  // Full per-day V2 shadow (not summary shortcut) — fire-and-forget.
  if (decision.forwardShadow) {
    const shadowDays = days
      .filter((d) => d.status !== 'outside_booking_horizon')
      .map((d) => ({ date: d.date, isAvailable: d.isAvailable }));
    schedulePublicAvailableDaysShadow({
      branchId: branchCtx.branchId,
      empId,
      employeeIds: empId ? [empId] : [],
      durationMinutes: selected.totalDurationMinutes,
      minNoticeMinutes: settings.minNoticeMinutes,
      days: shadowDays,
      legacyMs,
    });
  }

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
