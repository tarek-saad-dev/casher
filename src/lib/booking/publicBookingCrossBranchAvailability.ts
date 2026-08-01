/**
 * Booking Phase 10C — cross-branch public barber availability.
 * One emp → all public-eligible bookable branches → flat slots (no BranchID).
 */
import 'server-only';
import { AsyncLocalStorage } from 'async_hooks';
import { getPool, sql } from '@/lib/db';
import {
  resolvePublicBookingBranchContext,
  type PublicDiscoverableBranch,
} from '@/lib/booking/publicBookingBranchContext';
import {
  BookingServiceDurationError,
  resolveSelectedBookingServices,
} from '@/lib/booking/bookingServiceDuration';
import {
  eachDateInclusive,
  parsePublicServiceIdsParam,
} from '@/lib/booking/publicBookingBarberPolicy';
import {
  listSpecificEmpPublicSlotsMultiDate,
} from '@/lib/bookingAvailabilityEngine';
import { isValidDate, getPublicSettings } from '@/lib/publicBookingHelpers';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { isEmployeeHiddenFromPublicBooking } from '@/lib/hr/testEmployeePolicy';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';
import { createStageTimer } from '@/lib/devStageTiming';

export const MAX_CROSS_BRANCH_AVAILABILITY_DAYS = 14;
export const MAX_CROSS_BRANCH_AVAILABILITY_SERVICES = 12;
export const CROSS_BRANCH_AVAILABILITY_CONTRACT = 'xbranch-v1';

const CACHE_TTL_MS = 45_000;
const CACHE_MAX = 32;
const cacheRoot = '__pos_public_booking_xbranch_avail_v1';

type CacheEntry = { expiresAt: number; value: PublicCrossBranchAvailabilityResponse };

function cacheMap(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & {
    [cacheRoot]?: Map<string, CacheEntry>;
  };
  if (!g[cacheRoot]) g[cacheRoot] = new Map();
  return g[cacheRoot]!;
}

export function invalidatePublicBookingCrossBranchAvailabilityCache(): void {
  cacheMap().clear();
}

function cacheGet(key: string): PublicCrossBranchAvailabilityResponse | null {
  const hit = cacheMap().get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.value;
}

function cacheSet(key: string, value: PublicCrossBranchAvailabilityResponse): void {
  const map = cacheMap();
  if (map.size >= CACHE_MAX) {
    const first = map.keys().next().value;
    if (first) map.delete(first);
  }
  map.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

/** Best-effort SQL query counter for this request (AsyncLocalStorage). */
const queryCountAls = new AsyncLocalStorage<{ count: number }>();
let queryPatchInstalled = false;

function ensureQueryCountPatch(): void {
  if (queryPatchInstalled) return;
  queryPatchInstalled = true;
  const proto = sql.Request.prototype as {
    query: (this: sql.Request, ...args: unknown[]) => Promise<unknown>;
  };
  const orig = proto.query;
  proto.query = function patchedQuery(this: sql.Request, ...args: unknown[]) {
    const store = queryCountAls.getStore();
    if (store) store.count += 1;
    return orig.apply(this, args as Parameters<typeof orig>);
  };
}

export class PublicCrossBranchAvailabilityError extends Error {
  readonly code: PublicBookingErrorCode;
  constructor(code: PublicBookingErrorCode) {
    super(code);
    this.name = 'PublicCrossBranchAvailabilityError';
    this.code = code;
  }
}

export type PublicCrossBranchSlotWire = {
  branchCode: string;
  branchName: string;
  date: string;
  time: string;
  dayOffset: 0 | 1;
};

export type PublicCrossBranchAvailabilityResponse = {
  ok: true;
  barber: { empId: number; nameAr: string };
  branches: Array<{ branchCode: string; branchName: string }>;
  days: string[];
  slots: PublicCrossBranchSlotWire[];
  meta: {
    slotCount: number;
    branchCount: number;
    dayCount: number;
    queryCount: number;
    timingMs: Record<string, number>;
    cacheHit: boolean;
    failedBranchCodes: string[];
    contractVersion: string;
    generatedAt: string;
  };
};

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseServiceIds(raw: unknown): number[] {
  if (typeof raw === 'string') {
    const parsed = parsePublicServiceIdsParam(raw);
    if (!parsed.ok) throw new PublicCrossBranchAvailabilityError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
    return parsed.ids;
  }
  if (Array.isArray(raw)) {
    const parsed = parsePublicServiceIdsParam(
      raw
        .filter((x) => x != null && x !== '')
        .map(String)
        .join(','),
    );
    if (!parsed.ok) throw new PublicCrossBranchAvailabilityError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
    return parsed.ids;
  }
  throw new PublicCrossBranchAvailabilityError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
}

function parseDaysCount(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new PublicCrossBranchAvailabilityError('INVALID_DATE_RANGE');
  }
  if (n > MAX_CROSS_BRANCH_AVAILABILITY_DAYS) {
    throw new PublicCrossBranchAvailabilityError('DATE_RANGE_TOO_LARGE');
  }
  return n;
}

async function loadBarber(empId: number): Promise<{ empId: number; nameAr: string }> {
  const db = await getPool();
  const r = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`
      SELECT EmpName, ISNULL(isActive, 1) AS isActive
      FROM dbo.TblEmp
      WHERE EmpID = @empId
    `);
  const row = r.recordset[0];
  if (!row || !row.isActive) {
    throw new PublicCrossBranchAvailabilityError('BARBER_NOT_FOUND');
  }
  if (isEmployeeHiddenFromPublicBooking(row.EmpName)) {
    throw new PublicCrossBranchAvailabilityError('BARBER_NOT_FOUND');
  }
  return { empId, nameAr: String(row.EmpName) };
}

type AssignmentRow = {
  BranchID: number;
  BranchCode: string;
  BranchName: string;
  EffectiveFrom: Date | string;
  EffectiveTo: Date | string | null;
};

function ymdFromSqlDate(v: Date | string): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * One query: bookable assignments overlapping the window (CanReceiveBookings).
 * Does not encode public eligibility — caller intersects with discoverable branches.
 */
async function loadBookableAssignmentsInWindow(
  empId: number,
  dateFrom: string,
  dateTo: string,
): Promise<AssignmentRow[]> {
  const db = await getPool();
  const r = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('dateFrom', sql.Date, dateFrom)
    .input('dateTo', sql.Date, dateTo)
    .query(`
      SELECT
        ea.BranchID,
        b.BranchCode,
        b.BranchName,
        ea.EffectiveFrom,
        ea.EffectiveTo
      FROM dbo.TblEmpBranchAssignment ea
      INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
      INNER JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
      INNER JOIN dbo.QueueBookingSettings qbs ON qbs.BranchID = b.BranchID
      WHERE ea.EmpID = @empId
        AND ea.IsActive = 1
        AND ea.CanReceiveBookings = 1
        AND b.IsActive = 1
        AND ISNULL(e.isActive, 1) = 1
        AND b.LifecycleStatus = N'PUBLIC_LIVE'
        AND ISNULL(b.PublicBookingEnabled, 0) = 1
        AND ISNULL(qbs.BookingEnabled, 0) = 1
        AND ea.EffectiveFrom <= @dateTo
        AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @dateFrom)
      ORDER BY b.BranchCode ASC
    `);
  return r.recordset as AssignmentRow[];
}

function assignmentCoversDate(row: AssignmentRow, date: string): boolean {
  const from = ymdFromSqlDate(row.EffectiveFrom);
  const to = row.EffectiveTo == null ? null : ymdFromSqlDate(row.EffectiveTo);
  if (date < from) return false;
  if (to != null && date > to) return false;
  return true;
}

/**
 * Batch weekly schedules for emp × eligible branches (one query).
 * Used to skip obviously closed weekdays before engine calls (still correctness-safe:
 * engine re-validates; we only skip when no active schedule row says working).
 */
async function loadScheduleWorkingHints(
  empId: number,
  branchIds: number[],
  dateFrom: string,
  dateTo: string,
): Promise<Map<string, boolean>> {
  const hints = new Map<string, boolean>();
  if (!branchIds.length) return hints;
  const db = await getPool();
  const idList = branchIds.join(',');
  try {
    const r = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('dateFrom', sql.Date, dateFrom)
      .input('dateTo', sql.Date, dateTo)
      .query(`
        SELECT BranchID, DayOfWeek, IsWorking, EffectiveFrom, EffectiveTo,
          ROW_NUMBER() OVER (
            PARTITION BY BranchID, DayOfWeek
            ORDER BY EffectiveFrom DESC, ScheduleID DESC
          ) AS rn
        FROM dbo.TblEmpBranchWorkSchedule
        WHERE EmpID = @empId
          AND BranchID IN (${idList})
          AND IsActive = 1
          AND EffectiveFrom <= @dateTo
          AND (EffectiveTo IS NULL OR EffectiveTo >= @dateFrom)
      `);
    for (const row of r.recordset) {
      if (Number(row.rn) !== 1) continue;
      hints.set(
        `${Number(row.BranchID)}:${Number(row.DayOfWeek)}`,
        Boolean(row.IsWorking),
      );
    }
  } catch {
    /* hints optional — engine remains source of truth */
  }

  // Temporary transfers: force working at ToBranch for that WorkDate
  try {
    const xfer = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('dateFrom', sql.Date, dateFrom)
      .input('dateTo', sql.Date, dateTo)
      .query(`
        SELECT ToBranchID, FromBranchID, WorkDate
        FROM dbo.TblEmpTemporaryBranchTransfer
        WHERE EmpID = @empId
          AND IsActive = 1
          AND WorkDate >= @dateFrom
          AND WorkDate <= @dateTo
          AND (
            ToBranchID IN (${idList})
            OR FromBranchID IN (${idList})
          )
      `);
    for (const row of xfer.recordset) {
      const day = ymdFromSqlDate(row.WorkDate as Date | string);
      const toId = Number(row.ToBranchID);
      const fromId = Number(row.FromBranchID);
      if (branchIds.includes(toId)) {
        hints.set(`${toId}:date:${day}`, true);
      }
      if (branchIds.includes(fromId)) {
        hints.set(`${fromId}:date:${day}`, false);
      }
    }
  } catch {
    /* optional */
  }

  return hints;
}

function shouldSkipEngineForDay(args: {
  branchId: number;
  date: string;
  hints: Map<string, boolean>;
}): boolean | null {
  const dateHint = args.hints.get(`${args.branchId}:date:${args.date}`);
  if (dateHint === false) return true;
  if (dateHint === true) return false;
  const dow = new Date(`${args.date}T12:00:00Z`).getDay();
  const weekly = args.hints.get(`${args.branchId}:${dow}`);
  if (weekly === false) return true;
  if (weekly === true) return false;
  return null; // unknown — run engine
}

/** Build wire slots from multi-date engine map. */
function wireSlotsFromMultiDate(args: {
  branchCode: string;
  branchName: string;
  byDate: Map<string, Array<{ time: string; dayOffset: 0 | 1; available?: boolean }>>;
  dates: string[];
  horizonEnd: string;
}): PublicCrossBranchSlotWire[] {
  const out: PublicCrossBranchSlotWire[] = [];
  const today = getCairoBusinessDate();
  for (const date of args.dates) {
    if (date > args.horizonEnd || date < today) continue;
    const plans = args.byDate.get(date) ?? [];
    for (const s of plans) {
      if (s.available === false) continue;
      out.push({
        branchCode: args.branchCode,
        branchName: args.branchName,
        date,
        time: s.time,
        dayOffset: s.dayOffset,
      });
    }
  }
  return out;
}

function sortSlots(slots: PublicCrossBranchSlotWire[]): PublicCrossBranchSlotWire[] {
  return [...slots].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.dayOffset !== b.dayOffset) return a.dayOffset - b.dayOffset;
    if (a.time !== b.time) return a.time.localeCompare(b.time);
    return a.branchCode.localeCompare(b.branchCode);
  });
}

async function evaluateBranch(args: {
  discoverable: PublicDiscoverableBranch;
  assignments: AssignmentRow[];
  dates: string[];
  empId: number;
  serviceIds: number[];
  scheduleHints: Map<string, boolean>;
}): Promise<{
  branch: { branchCode: string; branchName: string };
  slots: PublicCrossBranchSlotWire[];
  failed: boolean;
}> {
  const wire = {
    branchCode: args.discoverable.branchCode,
    branchName: args.discoverable.branchName,
  };

  try {
    const branchCtx = await resolvePublicBookingBranchContext({
      branchCode: args.discoverable.branchCode,
      purpose: 'public_booking',
    });
    // Paused mid-flight / not bookable — omit slots, keep silence (no false slots)
    if (!branchCtx.bookingEnabled || !branchCtx.publicBookingEnabled) {
      return { branch: wire, slots: [], failed: false };
    }

    let selected;
    try {
      selected = await resolveSelectedBookingServices({
        branchContext: branchCtx,
        serviceIds: args.serviceIds,
      });
    } catch (err) {
      if (err instanceof BookingServiceDurationError) {
        return { branch: wire, slots: [], failed: false };
      }
      throw err;
    }

    const settings = await getPublicSettings(branchCtx.branchId);
    const horizonEnd = addDaysYmd(getCairoBusinessDate(), settings.maxBookingDaysAhead);
    const branchAssignments = args.assignments.filter(
      (a) => a.BranchID === args.discoverable.branchId,
    );

    const engineDates = args.dates.filter((date) => {
      if (!branchAssignments.some((a) => assignmentCoversDate(a, date))) return false;
      const skip = shouldSkipEngineForDay({
        branchId: args.discoverable.branchId,
        date,
        hints: args.scheduleHints,
      });
      return skip !== true;
    });

    if (!engineDates.length) {
      return { branch: wire, slots: [], failed: false };
    }

    const byDate = await listSpecificEmpPublicSlotsMultiDate({
      empId: args.empId,
      branchId: args.discoverable.branchId,
      dates: engineDates,
      serviceIds: selected.serviceIds,
      durationOverride: selected.totalDurationMinutes,
      assumeEligible: true,
    });

    const slots = wireSlotsFromMultiDate({
      branchCode: wire.branchCode,
      branchName: wire.branchName,
      byDate,
      dates: engineDates,
      horizonEnd,
    });

    return { branch: wire, slots, failed: false };
  } catch (err) {
    console.error(
      '[public/booking/cross-branch-availability] branch failed',
      wire.branchCode,
      err instanceof Error ? err.message : 'error',
    );
    return { branch: wire, slots: [], failed: true };
  }
}

/**
 * POST body handler — barber availability across all public bookable branches.
 */
export async function getPublicCrossBranchBarberAvailability(args: {
  empId: number;
  serviceIds: unknown;
  dateFrom: unknown;
  days: unknown;
}): Promise<PublicCrossBranchAvailabilityResponse> {
  ensureQueryCountPatch();

  if (!Number.isFinite(args.empId) || args.empId <= 0) {
    throw new PublicCrossBranchAvailabilityError('BARBER_NOT_FOUND');
  }

  const dateFrom =
    typeof args.dateFrom === 'string' && isValidDate(args.dateFrom)
      ? args.dateFrom
      : null;
  if (!dateFrom) throw new PublicCrossBranchAvailabilityError('INVALID_DATE');

  const daysCount = parseDaysCount(args.days);
  const dateTo = addDaysYmd(dateFrom, daysCount - 1);
  const dates = eachDateInclusive(dateFrom, dateTo);

  const serviceIds = parseServiceIds(args.serviceIds);
  if (serviceIds.length === 0) {
    throw new PublicCrossBranchAvailabilityError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
  }
  if (serviceIds.length > MAX_CROSS_BRANCH_AVAILABILITY_SERVICES) {
    throw new PublicCrossBranchAvailabilityError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
  }

  const cacheKey = [
    'xbranch',
    args.empId,
    dateFrom,
    daysCount,
    serviceIds.join(','),
    CROSS_BRANCH_AVAILABILITY_CONTRACT,
  ].join('::');

  const cached = cacheGet(cacheKey);
  if (cached) {
    return {
      ...cached,
      meta: {
        ...cached.meta,
        cacheHit: true,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  const store = { count: 0 };
  return queryCountAls.run(store, async () => {
    const timer = createStageTimer(true);
    const barber = await loadBarber(args.empId);
    timer.mark('barberMs');

    const assignments = await loadBookableAssignmentsInWindow(
      args.empId,
      dateFrom,
      dateTo,
    );
    timer.mark('eligibilityMs');

    // Assignments query already restricted to public-eligible (all-four) branches
    const uniqueAssign = new Map<number, AssignmentRow>();
    for (const a of assignments) {
      if (!uniqueAssign.has(a.BranchID)) uniqueAssign.set(a.BranchID, a);
    }
    const eligibleDiscoverable: PublicDiscoverableBranch[] = [...uniqueAssign.values()]
      .map((a) => ({
        branchId: a.BranchID,
        branchCode: a.BranchCode,
        branchName: a.BranchName,
        shortName: null,
        address: null,
        phone: null,
        timeZone: 'Africa/Cairo',
      }))
      .sort((a, b) => a.branchCode.localeCompare(b.branchCode));
    timer.mark('publicFilterMs');    const scheduleHints = await loadScheduleWorkingHints(
      args.empId,
      eligibleDiscoverable.map((b) => b.branchId),
      dateFrom,
      dateTo,
    );
    timer.mark('scheduleBatchMs');

    // Evaluate branches in parallel — one failure must not invent slots
    const branchOutcomes = await Promise.all(
      eligibleDiscoverable.map((branch) =>
        evaluateBranch({
          discoverable: branch,
          assignments,
          dates,
          empId: args.empId,
          serviceIds,
          scheduleHints,
        }),
      ),
    );
    timer.mark('slotsMs');

    const failedBranchCodes = branchOutcomes
      .filter((o) => o.failed)
      .map((o) => o.branch.branchCode);
    const branches = branchOutcomes.map((o) => o.branch);
    const slots = sortSlots(branchOutcomes.flatMap((o) => o.slots));
    const timingMs = timer.finish('[xbranch-availability]');

    const response: PublicCrossBranchAvailabilityResponse = {
      ok: true,
      barber,
      branches,
      days: dates,
      slots,
      meta: {
        slotCount: slots.length,
        branchCount: branches.length,
        dayCount: dates.length,
        queryCount: store.count,
        timingMs,
        cacheHit: false,
        failedBranchCodes,
        contractVersion: CROSS_BRANCH_AVAILABILITY_CONTRACT,
        generatedAt: new Date().toISOString(),
      },
    };

    // Cache without volatile generatedAt drift on hit path (we overwrite on hit)
    cacheSet(cacheKey, response);
    return response;
  });
}
