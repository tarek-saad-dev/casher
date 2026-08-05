/**
 * Phase 1C — aggregate multi-branch barber availability orchestration.
 * Reuses listSpecificEmpPublicSlotsMultiDate (same engine as available-days/slots).
 * Does not duplicate scheduling SQL or plan/create contracts.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  normalizePublicBranchCode,
  resolvePublicBookingBranchContext,
  PublicBookingBranchContextError,
  type PublicBookingBranchContext,
} from '@/lib/booking/publicBookingBranchContext';
import {
  BookingServiceDurationError,
  resolveSelectedBookingServices,
  type ResolvedSelectedBookingServices,
} from '@/lib/booking/bookingServiceDuration';
import {
  eachDateInclusive,
  isBarberJob,
  isEmployeeActive,
  parsePublicServiceIdsParam,
} from '@/lib/booking/publicBookingBarberPolicy';
import { listSpecificEmpPublicSlotsMultiDate } from '@/lib/bookingAvailabilityEngine';
import { getPublicSettings, isValidDate, salonDateTimeToMs } from '@/lib/publicBookingHelpers';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { isEmployeeHiddenFromPublicBooking } from '@/lib/hr/testEmployeePolicy';
import {
  ensureTblEmpNameEnColumn,
  normalizeEmpNameEn,
} from '@/lib/migrations/ensureEmployeeNameEn';
import { getBarberNameEnByArabicName } from '@/lib/barberImages';
import { resolveBranchDisplayIdentity } from '@/lib/branch/branchDisplayIdentity';
import { validateEmployeeSupportsServices } from '@/lib/employeeServiceEligibility';
import { PUBLIC_BOOKING_CURRENCY } from '@/lib/booking/publicBookingServicePolicy';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';
import { createStageTimer } from '@/lib/devStageTiming';
import {
  BRANCH_EVAL_CONCURRENCY,
  MAX_BARBER_AVAILABILITY_DAYS,
  MAX_BARBER_AVAILABILITY_SERVICES,
  buildBarberAvailabilitySlotId,
  humanizeBranchCode,
  sortBarberAvailabilitySlotsByAbsoluteStart,
} from '@/lib/booking/publicBarberMultiBranchAvailabilityPure';

export {
  BRANCH_EVAL_CONCURRENCY,
  MAX_BARBER_AVAILABILITY_DAYS,
  MAX_BARBER_AVAILABILITY_SERVICES,
  buildBarberAvailabilitySlotId,
  humanizeBranchCode,
  sortBarberAvailabilitySlotsByAbsoluteStart,
} from '@/lib/booking/publicBarberMultiBranchAvailabilityPure';

export const BARBER_MULTI_BRANCH_AVAILABILITY_CONTRACT = 'barber-xbranch-days-slots-v1';

const CACHE_TTL_MS = 45_000;
const CACHE_MAX = 48;
const cacheRoot = '__pos_public_booking_barber_xbranch_v1';

type CacheEntry = { expiresAt: number; value: unknown };

function cacheMap(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & {
    [cacheRoot]?: Map<string, CacheEntry>;
  };
  if (!g[cacheRoot]) g[cacheRoot] = new Map();
  return g[cacheRoot]!;
}

export function invalidatePublicBarberMultiBranchAvailabilityCache(): void {
  cacheMap().clear();
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

export class PublicBarberMultiBranchAvailabilityError extends Error {
  readonly code: PublicBookingErrorCode;
  constructor(code: PublicBookingErrorCode) {
    super(code);
    this.name = 'PublicBarberMultiBranchAvailabilityError';
    this.code = code;
  }
}

export type BarberAvailabilityScope = 'all_public' | 'specific_branch';

export type PublicBarberWireLite = {
  id: number;
  name: string;
  nameAr: string;
  nameEn: string;
};

export type PublicBranchWireLite = {
  branchCode: string;
  branchName: string;
  branchNameAr: string;
  branchNameEn: string;
};

export type BarberDayBranchSummary = {
  branchCode: string;
  slotsCount: number;
  earliestTime: string;
  earliestDayOffset: 0 | 1;
  hasOvernightSlots: boolean;
};

export type BarberAvailabilityDayWire = {
  date: string;
  available: boolean;
  branches: BarberDayBranchSummary[];
};

export type BarberAvailabilityWarning = {
  branchCode: string;
  code: 'BRANCH_AVAILABILITY_UNAVAILABLE';
};

export type BarberAvailabilityDaysResponse = {
  ok: true;
  barber: PublicBarberWireLite;
  scope: BarberAvailabilityScope;
  branches: PublicBranchWireLite[];
  days: BarberAvailabilityDayWire[];
  partial: boolean;
  warnings: BarberAvailabilityWarning[];
};

export type BarberAvailabilitySlotWire = {
  slotId: string;
  empId: number;
  barberName: string;
  branchCode: string;
  branchName: string;
  branchNameAr: string;
  branchNameEn: string;
  date: string;
  time: string;
  dayOffset: 0 | 1;
  startDateTime: string;
  endDateTime: string;
  duration: number;
  price: number;
  currency: typeof PUBLIC_BOOKING_CURRENCY;
};

export type BarberAvailabilitySlotsResponse = {
  ok: true;
  barber: PublicBarberWireLite;
  date: string;
  scope: BarberAvailabilityScope;
  slots: BarberAvailabilitySlotWire[];
  partial: boolean;
  warnings: BarberAvailabilityWarning[];
};

type AssignmentRow = {
  BranchID: number;
  BranchCode: string;
  BranchName: string;
  EffectiveFrom: Date | string;
  EffectiveTo: Date | string | null;
};

type ResolvedBranch = PublicBranchWireLite & {
  branchId: number;
};

type EngineSlot = {
  time: string;
  dayOffset: 0 | 1;
  startAt?: string;
  endAt?: string;
  available?: boolean;
};

type BranchEvalOk = {
  branch: ResolvedBranch;
  failed: false;
  byDate: Map<string, EngineSlot[]>;
  selected: ResolvedSelectedBookingServices;
  timezone: string;
};

type BranchEvalFail = {
  branch: ResolvedBranch;
  failed: true;
};

type BranchEval = BranchEvalOk | BranchEvalFail;

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addDaysYmdForTests(ymd: string, days: number): string {
  return addDaysYmd(ymd, days);
}

function ymdFromSqlDate(v: Date | string): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function assignmentCoversDate(row: AssignmentRow, date: string): boolean {
  const from = ymdFromSqlDate(row.EffectiveFrom);
  const to = row.EffectiveTo == null ? null : ymdFromSqlDate(row.EffectiveTo);
  if (date < from) return false;
  if (to != null && date > to) return false;
  return true;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseScope(raw: unknown): BarberAvailabilityScope {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'all_public') return 'all_public';
  if (s === 'specific_branch') return 'specific_branch';
  throw new PublicBarberMultiBranchAvailabilityError('INVALID_AVAILABILITY_SCOPE');
}

function parseServiceIds(raw: unknown): number[] {
  if (typeof raw === 'string') {
    const parsed = parsePublicServiceIdsParam(raw);
    if (!parsed.ok) throw new PublicBarberMultiBranchAvailabilityError('INVALID_SERVICE_IDS');
    return parsed.ids;
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new PublicBarberMultiBranchAvailabilityError('INVALID_SERVICE_IDS');
    }
    if (raw.length > MAX_BARBER_AVAILABILITY_SERVICES * 2) {
      throw new PublicBarberMultiBranchAvailabilityError('INVALID_SERVICE_IDS');
    }
    const parsed = parsePublicServiceIdsParam(
      raw
        .filter((x) => x != null && x !== '')
        .map(String)
        .join(','),
    );
    if (!parsed.ok) throw new PublicBarberMultiBranchAvailabilityError('INVALID_SERVICE_IDS');
    return parsed.ids;
  }
  throw new PublicBarberMultiBranchAvailabilityError('INVALID_SERVICE_IDS');
}

function parseDaysCount(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new PublicBarberMultiBranchAvailabilityError('INVALID_DATE_RANGE');
  }
  if (n > MAX_BARBER_AVAILABILITY_DAYS) {
    throw new PublicBarberMultiBranchAvailabilityError('DATE_RANGE_TOO_LARGE');
  }
  return n;
}

function slotAbsMs(args: {
  date: string;
  time: string;
  dayOffset: 0 | 1;
  timezone: string;
}): number {
  const slotDate = args.dayOffset === 1 ? addDaysYmd(args.date, 1) : args.date;
  return salonDateTimeToMs(slotDate, args.time, args.timezone);
}

function buildSlotId(args: {
  empId: number;
  branchCode: string;
  date: string;
  time: string;
  dayOffset: 0 | 1;
}): string {
  return buildBarberAvailabilitySlotId(args);
}

async function loadPublicBarber(empId: number): Promise<PublicBarberWireLite> {
  if (!Number.isFinite(empId) || empId <= 0) {
    throw new PublicBarberMultiBranchAvailabilityError('BARBER_NOT_FOUND');
  }
  const db = await getPool();
  const hasNameEn = await ensureTblEmpNameEnColumn(db);
  const nameEnSelect = hasNameEn
    ? 'EmpNameEn'
    : 'CAST(NULL AS NVARCHAR(200)) AS EmpNameEn';
  const r = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`
      SELECT EmpName, ISNULL(isActive, 1) AS isActive, Job, ${nameEnSelect}
      FROM dbo.TblEmp
      WHERE EmpID = @empId
    `);
  const row = r.recordset[0];
  if (!row) {
    throw new PublicBarberMultiBranchAvailabilityError('BARBER_NOT_FOUND');
  }
  const nameAr = String(row.EmpName);
  if (!isEmployeeActive(row.isActive) || isEmployeeHiddenFromPublicBooking(nameAr)) {
    throw new PublicBarberMultiBranchAvailabilityError('BARBER_NOT_FOUND');
  }
  if (!isBarberJob(row.Job)) {
    throw new PublicBarberMultiBranchAvailabilityError('BARBER_NOT_BOOKABLE');
  }
  const nameEn =
    normalizeEmpNameEn(row.EmpNameEn) ?? getBarberNameEnByArabicName(nameAr) ?? nameAr;
  return {
    id: empId,
    name: nameEn,
    nameAr,
    nameEn,
  };
}

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

async function toResolvedBranch(row: AssignmentRow): Promise<ResolvedBranch> {
  const branchCode = String(row.BranchCode).trim().toUpperCase();
  const branchNameAr = String(row.BranchName);
  let branchNameEn = humanizeBranchCode(branchCode);
  try {
    const identity = await resolveBranchDisplayIdentity(row.BranchID);
    if (identity?.englishDisplayName) {
      branchNameEn = identity.englishDisplayName;
    }
  } catch {
    /* fallback already set */
  }
  return {
    branchId: row.BranchID,
    branchCode,
    branchName: branchNameAr,
    branchNameAr,
    branchNameEn,
  };
}

async function resolveTargetBranches(args: {
  empId: number;
  scope: BarberAvailabilityScope;
  branchCodeRaw: unknown;
  dateFrom: string;
  dateTo: string;
}): Promise<{ branches: ResolvedBranch[]; assignments: AssignmentRow[] }> {
  const assignments = await loadBookableAssignmentsInWindow(
    args.empId,
    args.dateFrom,
    args.dateTo,
  );

  const unique = new Map<number, AssignmentRow>();
  for (const a of assignments) {
    const code = String(a.BranchCode).trim().toUpperCase();
    if (!code) continue;
    if (!unique.has(a.BranchID)) unique.set(a.BranchID, a);
  }

  if (args.scope === 'specific_branch') {
    if (args.branchCodeRaw == null || String(args.branchCodeRaw).trim() === '') {
      throw new PublicBarberMultiBranchAvailabilityError('BRANCH_REQUIRED');
    }
    let normalized: string;
    try {
      normalized = normalizePublicBranchCode(String(args.branchCodeRaw));
    } catch (err) {
      if (err instanceof PublicBookingBranchContextError) {
        throw new PublicBarberMultiBranchAvailabilityError(err.code);
      }
      throw err;
    }

    const match = [...unique.values()].find(
      (a) => String(a.BranchCode).trim().toUpperCase() === normalized,
    );
    if (!match) {
      // Distinguish: branch not public vs barber not assigned
      try {
        const ctx = await resolvePublicBookingBranchContext({
          branchCode: normalized,
          purpose: 'public_booking',
        });
        if (!ctx.bookingEnabled || !ctx.publicBookingEnabled) {
          throw new PublicBarberMultiBranchAvailabilityError('BRANCH_NOT_PUBLIC');
        }
        throw new PublicBarberMultiBranchAvailabilityError('BARBER_NOT_ASSIGNED');
      } catch (err) {
        if (err instanceof PublicBarberMultiBranchAvailabilityError) throw err;
        if (err instanceof PublicBookingBranchContextError) {
          throw new PublicBarberMultiBranchAvailabilityError(err.code);
        }
        throw new PublicBarberMultiBranchAvailabilityError('BARBER_NOT_ASSIGNED');
      }
    }

    return {
      branches: [await toResolvedBranch(match)],
      assignments,
    };
  }

  if (!unique.size) {
    throw new PublicBarberMultiBranchAvailabilityError('NO_PUBLIC_BRANCHES_FOR_BARBER');
  }

  const branches = await Promise.all(
    [...unique.values()]
      .sort((a, b) =>
        String(a.BranchCode).toUpperCase().localeCompare(String(b.BranchCode).toUpperCase()),
      )
      .map((row) => toResolvedBranch(row)),
  );

  // Deduplicate by normalized branchCode
  const byCode = new Map<string, ResolvedBranch>();
  for (const b of branches) {
    if (!byCode.has(b.branchCode)) byCode.set(b.branchCode, b);
  }

  return { branches: [...byCode.values()], assignments };
}

async function assertServicesAllowed(
  empId: number,
  serviceIds: number[],
): Promise<void> {
  if (!serviceIds.length) {
    throw new PublicBarberMultiBranchAvailabilityError('INVALID_SERVICE_IDS');
  }
  if (serviceIds.length > MAX_BARBER_AVAILABILITY_SERVICES) {
    throw new PublicBarberMultiBranchAvailabilityError('INVALID_SERVICE_IDS');
  }
  const support = await validateEmployeeSupportsServices({
    employeeId: empId,
    serviceIds,
  });
  if (!support.valid) {
    throw new PublicBarberMultiBranchAvailabilityError('BARBER_CANNOT_PERFORM_SERVICE');
  }
}

async function evaluateBranchAvailability(args: {
  branch: ResolvedBranch;
  assignments: AssignmentRow[];
  dates: string[];
  empId: number;
  serviceIds: number[];
  failHard: boolean;
}): Promise<BranchEval> {
  try {
    let branchCtx: PublicBookingBranchContext;
    try {
      branchCtx = await resolvePublicBookingBranchContext({
        branchCode: args.branch.branchCode,
        purpose: 'public_booking',
      });
    } catch (err) {
      if (err instanceof PublicBookingBranchContextError) {
        if (args.failHard) {
          throw new PublicBarberMultiBranchAvailabilityError(err.code);
        }
        return { branch: args.branch, failed: true };
      }
      throw err;
    }

    if (!branchCtx.bookingEnabled || !branchCtx.publicBookingEnabled) {
      if (args.failHard) {
        throw new PublicBarberMultiBranchAvailabilityError('BRANCH_NOT_PUBLIC');
      }
      return {
        branch: args.branch,
        failed: false,
        byDate: new Map(args.dates.map((d) => [d, []])),
        selected: {
          services: [],
          serviceIds: args.serviceIds,
          totalDurationMinutes: 0,
          totalPrice: 0,
        },
        timezone: branchCtx.timezone || 'Africa/Cairo',
      };
    }

    let selected: ResolvedSelectedBookingServices;
    try {
      selected = await resolveSelectedBookingServices({
        branchContext: branchCtx,
        serviceIds: args.serviceIds,
      });
    } catch (err) {
      if (err instanceof BookingServiceDurationError) {
        const mapped =
          err.code === 'INVALID_SERVICE_IDS'
            ? 'INVALID_SERVICE_IDS'
            : err.code === 'SERVICES_NOT_CONFIGURED'
              ? 'SERVICES_NOT_CONFIGURED'
              : 'SERVICE_NOT_AVAILABLE_AT_BRANCH';
        if (args.failHard) {
          throw new PublicBarberMultiBranchAvailabilityError(mapped);
        }
        // Service not offered at this branch — empty, not a hard failure for all_public
        return {
          branch: args.branch,
          failed: false,
          byDate: new Map(args.dates.map((d) => [d, []])),
          selected: {
            services: [],
            serviceIds: args.serviceIds,
            totalDurationMinutes: 0,
            totalPrice: 0,
          },
          timezone: branchCtx.timezone || 'Africa/Cairo',
        };
      }
      throw err;
    }

    const settings = await getPublicSettings(branchCtx.branchId);
    const horizonEnd = addDaysYmd(getCairoBusinessDate(), settings.maxBookingDaysAhead);
    const today = getCairoBusinessDate();
    const branchAssignments = args.assignments.filter((a) => a.BranchID === args.branch.branchId);

    const engineDates = args.dates.filter((date) => {
      if (date < today || date > horizonEnd) return false;
      return branchAssignments.some((a) => assignmentCoversDate(a, date));
    });

    const byDate = new Map<string, EngineSlot[]>();
    for (const d of args.dates) byDate.set(d, []);

    if (engineDates.length && selected.totalDurationMinutes > 0) {
      const engineMap = await listSpecificEmpPublicSlotsMultiDate({
        empId: args.empId,
        branchId: args.branch.branchId,
        dates: engineDates,
        serviceIds: selected.serviceIds,
        durationOverride: selected.totalDurationMinutes,
        assumeEligible: true,
      });
      for (const date of engineDates) {
        const plans = engineMap.get(date) ?? [];
        byDate.set(
          date,
          plans.filter((s) => s.available !== false),
        );
      }
    }

    return {
      branch: args.branch,
      failed: false,
      byDate,
      selected,
      timezone: settings.timezone || branchCtx.timezone || 'Africa/Cairo',
    };
  } catch (err) {
    if (err instanceof PublicBarberMultiBranchAvailabilityError) throw err;
    console.error(
      '[public/booking/barber-multi-branch] branch failed',
      args.branch.branchCode,
      err instanceof Error ? err.message : 'error',
    );
    if (args.failHard) {
      throw new PublicBarberMultiBranchAvailabilityError('BRANCH_AVAILABILITY_UNAVAILABLE');
    }
    return { branch: args.branch, failed: true };
  }
}

function summarizeDayBranches(
  outcomes: BranchEvalOk[],
  date: string,
): BarberDayBranchSummary[] {
  const summaries: BarberDayBranchSummary[] = [];
  for (const o of outcomes) {
    const slots = o.byDate.get(date) ?? [];
    if (!slots.length) continue;
    let earliest = slots[0]!;
    let earliestMs = slotAbsMs({
      date,
      time: earliest.time,
      dayOffset: earliest.dayOffset,
      timezone: o.timezone,
    });
    let hasOvernight = earliest.dayOffset === 1;
    for (let i = 1; i < slots.length; i++) {
      const s = slots[i]!;
      if (s.dayOffset === 1) hasOvernight = true;
      const ms = slotAbsMs({
        date,
        time: s.time,
        dayOffset: s.dayOffset,
        timezone: o.timezone,
      });
      if (ms < earliestMs) {
        earliestMs = ms;
        earliest = s;
      }
    }
    summaries.push({
      branchCode: o.branch.branchCode,
      slotsCount: slots.length,
      earliestTime: earliest.time,
      earliestDayOffset: earliest.dayOffset,
      hasOvernightSlots: hasOvernight,
    });
  }
  summaries.sort((a, b) => a.branchCode.localeCompare(b.branchCode));
  return summaries;
}

function buildSlotWires(args: {
  outcomes: BranchEvalOk[];
  empId: number;
  barberName: string;
  date: string;
}): BarberAvailabilitySlotWire[] {
  const out: BarberAvailabilitySlotWire[] = [];
  for (const o of args.outcomes) {
    if (!o.selected.totalDurationMinutes) continue;
    const slots = o.byDate.get(args.date) ?? [];
    for (const s of slots) {
      const startMs =
        s.startAt != null
          ? new Date(s.startAt).getTime()
          : slotAbsMs({
              date: args.date,
              time: s.time,
              dayOffset: s.dayOffset,
              timezone: o.timezone,
            });
      const endMs =
        s.endAt != null
          ? new Date(s.endAt).getTime()
          : startMs + o.selected.totalDurationMinutes * 60_000;
      out.push({
        slotId: buildSlotId({
          empId: args.empId,
          branchCode: o.branch.branchCode,
          date: args.date,
          time: s.time,
          dayOffset: s.dayOffset,
        }),
        empId: args.empId,
        barberName: args.barberName,
        branchCode: o.branch.branchCode,
        branchName: o.branch.branchName,
        branchNameAr: o.branch.branchNameAr,
        branchNameEn: o.branch.branchNameEn,
        date: args.date,
        time: s.time,
        dayOffset: s.dayOffset,
        startDateTime: new Date(startMs).toISOString(),
        endDateTime: new Date(endMs).toISOString(),
        duration: o.selected.totalDurationMinutes,
        price: o.selected.totalPrice,
        currency: PUBLIC_BOOKING_CURRENCY,
      });
    }
  }
  return sortBarberAvailabilitySlotsByAbsoluteStart(out);
}

type ResolvedCommon = {
  barber: PublicBarberWireLite;
  scope: BarberAvailabilityScope;
  serviceIds: number[];
  branches: ResolvedBranch[];
  assignments: AssignmentRow[];
  dates: string[];
};

async function resolveCommon(args: {
  empId: number;
  serviceIds: unknown;
  scope: unknown;
  branchCode: unknown;
  dateFrom: string;
  dateTo: string;
  dates: string[];
}): Promise<ResolvedCommon> {
  const scope = parseScope(args.scope);
  const serviceIds = parseServiceIds(args.serviceIds);
  if (!serviceIds.length) {
    throw new PublicBarberMultiBranchAvailabilityError('INVALID_SERVICE_IDS');
  }

  const barber = await loadPublicBarber(args.empId);
  await assertServicesAllowed(args.empId, serviceIds);

  const { branches, assignments } = await resolveTargetBranches({
    empId: args.empId,
    scope,
    branchCodeRaw: args.branchCode,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
  });

  return {
    barber,
    scope,
    serviceIds,
    branches,
    assignments,
    dates: args.dates,
  };
}

async function runBranchEvals(
  common: ResolvedCommon,
): Promise<{ ok: BranchEvalOk[]; warnings: BarberAvailabilityWarning[]; partial: boolean }> {
  const failHard = common.scope === 'specific_branch';
  const outcomes = await mapPool(common.branches, BRANCH_EVAL_CONCURRENCY, (branch) =>
    evaluateBranchAvailability({
      branch,
      assignments: common.assignments,
      dates: common.dates,
      empId: common.barber.id,
      serviceIds: common.serviceIds,
      failHard,
    }),
  );

  const failed = outcomes.filter((o): o is BranchEvalFail => o.failed);
  const ok = outcomes.filter((o): o is BranchEvalOk => !o.failed);

  if (!ok.length) {
    throw new PublicBarberMultiBranchAvailabilityError(
      failHard ? 'BRANCH_AVAILABILITY_UNAVAILABLE' : 'AVAILABILITY_UNAVAILABLE',
    );
  }

  const warnings: BarberAvailabilityWarning[] = failed.map((f) => ({
    branchCode: f.branch.branchCode,
    code: 'BRANCH_AVAILABILITY_UNAVAILABLE',
  }));

  return {
    ok,
    warnings,
    partial: warnings.length > 0,
  };
}

/**
 * POST …/barbers/:empId/availability/days
 */
export async function getBarberAvailabilityDays(args: {
  empId: number;
  serviceIds: unknown;
  dateFrom: unknown;
  days: unknown;
  scope: unknown;
  branchCode?: unknown;
}): Promise<BarberAvailabilityDaysResponse> {
  const dateFrom =
    typeof args.dateFrom === 'string' && isValidDate(args.dateFrom) ? args.dateFrom : null;
  if (!dateFrom) throw new PublicBarberMultiBranchAvailabilityError('INVALID_DATE');

  const daysCount = parseDaysCount(args.days);
  const dateTo = addDaysYmd(dateFrom, daysCount - 1);
  const dates = eachDateInclusive(dateFrom, dateTo);

  const scopePreview = parseScope(args.scope);
  const servicePreview = parseServiceIds(args.serviceIds);
  const branchKey =
    scopePreview === 'specific_branch'
      ? String(args.branchCode ?? '').trim().toUpperCase()
      : 'ALL';
  const cacheKey = [
    'days',
    args.empId,
    dateFrom,
    daysCount,
    servicePreview.join(','),
    scopePreview,
    branchKey,
    BARBER_MULTI_BRANCH_AVAILABILITY_CONTRACT,
  ].join('::');

  const cached = cacheGet<BarberAvailabilityDaysResponse>(cacheKey);
  if (cached) return cached;

  const timer = createStageTimer(true);
  const common = await resolveCommon({
    empId: args.empId,
    serviceIds: args.serviceIds,
    scope: args.scope,
    branchCode: args.branchCode,
    dateFrom,
    dateTo,
    dates,
  });
  timer.mark('resolveMs');

  const { ok, warnings, partial } = await runBranchEvals(common);
  timer.mark('branchesMs');

  const days: BarberAvailabilityDayWire[] = dates.map((date) => {
    const branches = summarizeDayBranches(ok, date);
    return {
      date,
      available: branches.length > 0,
      branches,
    };
  });

  const response: BarberAvailabilityDaysResponse = {
    ok: true,
    barber: common.barber,
    scope: common.scope,
    branches: common.branches.map((b) => ({
      branchCode: b.branchCode,
      branchName: b.branchName,
      branchNameAr: b.branchNameAr,
      branchNameEn: b.branchNameEn,
    })),
    days,
    partial,
    warnings,
  };

  const timing = timer.finish('[barber-xbranch-days]');
  console.log(
    '[public/booking/barber-availability-days]',
    JSON.stringify({
      empId: common.barber.id,
      scope: common.scope,
      branchCount: common.branches.length,
      dayCount: dates.length,
      partial,
      timingMs: timing,
    }),
  );

  cacheSet(cacheKey, response);
  return response;
}

/**
 * POST …/barbers/:empId/availability/slots
 */
export async function getBarberAvailabilitySlots(args: {
  empId: number;
  serviceIds: unknown;
  date: unknown;
  scope: unknown;
  branchCode?: unknown;
}): Promise<BarberAvailabilitySlotsResponse> {
  const date = typeof args.date === 'string' && isValidDate(args.date) ? args.date : null;
  if (!date) throw new PublicBarberMultiBranchAvailabilityError('INVALID_DATE');

  const scopePreview = parseScope(args.scope);
  const servicePreview = parseServiceIds(args.serviceIds);
  const branchKey =
    scopePreview === 'specific_branch'
      ? String(args.branchCode ?? '').trim().toUpperCase()
      : 'ALL';
  const cacheKey = [
    'slots',
    args.empId,
    date,
    servicePreview.join(','),
    scopePreview,
    branchKey,
    BARBER_MULTI_BRANCH_AVAILABILITY_CONTRACT,
  ].join('::');

  const cached = cacheGet<BarberAvailabilitySlotsResponse>(cacheKey);
  if (cached) return cached;

  const timer = createStageTimer(true);
  const common = await resolveCommon({
    empId: args.empId,
    serviceIds: args.serviceIds,
    scope: args.scope,
    branchCode: args.branchCode,
    dateFrom: date,
    dateTo: date,
    dates: [date],
  });
  timer.mark('resolveMs');

  const { ok, warnings, partial } = await runBranchEvals(common);
  timer.mark('branchesMs');

  const slots = buildSlotWires({
    outcomes: ok,
    empId: common.barber.id,
    barberName: common.barber.name,
    date,
  });

  const response: BarberAvailabilitySlotsResponse = {
    ok: true,
    barber: common.barber,
    date,
    scope: common.scope,
    slots,
    partial,
    warnings,
  };

  const timing = timer.finish('[barber-xbranch-slots]');
  console.log(
    '[public/booking/barber-availability-slots]',
    JSON.stringify({
      empId: common.barber.id,
      scope: common.scope,
      branchCount: common.branches.length,
      slotCount: slots.length,
      partial,
      timingMs: timing,
    }),
  );

  cacheSet(cacheKey, response);
  return response;
}

/** Alias for orchestration entry used by docs / callers. */
export async function getBarberAvailabilityAcrossBranches(args: {
  empId: number;
  serviceIds: unknown;
  scope: unknown;
  branchCode?: unknown;
  mode: 'days' | 'slots';
  dateFrom?: unknown;
  days?: unknown;
  date?: unknown;
}): Promise<BarberAvailabilityDaysResponse | BarberAvailabilitySlotsResponse> {
  if (args.mode === 'days') {
    return getBarberAvailabilityDays({
      empId: args.empId,
      serviceIds: args.serviceIds,
      dateFrom: args.dateFrom,
      days: args.days,
      scope: args.scope,
      branchCode: args.branchCode,
    });
  }
  return getBarberAvailabilitySlots({
    empId: args.empId,
    serviceIds: args.serviceIds,
    date: args.date,
    scope: args.scope,
    branchCode: args.branchCode,
  });
}
