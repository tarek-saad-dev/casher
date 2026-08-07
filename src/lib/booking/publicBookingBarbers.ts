/**
 * Booking Phase 3 — public barbers catalog, calendar, location.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  PublicBookingBranchContextError,
  resolvePublicBookingBranchContext,
  type PublicBookingBranchContext,
} from '@/lib/booking/publicBookingBranchContext';
import {
  getPublicBookingServicesCatalog,
  invalidatePublicBookingServicesCache,
} from '@/lib/booking/publicBookingServices';
import {
  MAX_PUBLIC_BARBER_CALENDAR_DAYS,
  PUBLIC_BOOKING_BARBER_CONTRACT_VERSION,
  comparePublicBarbers,
  dedupeBarbersByEmpId,
  eachDateInclusive,
  evaluateEmployeePublicBookingEligibility,
  inclusiveDaySpan,
  isBarberJob,
  isEmployeeActive,
  isOutsideBookingHorizon,
  resolveBarberPublicImageUrl,
  type PublicBarberCalendarStatus,
} from '@/lib/booking/publicBookingBarberPolicy';
import {
  excludeTestSmokeSqlPredicate,
  isEmployeeHiddenFromPublicBooking,
} from '@/lib/hr/testEmployeePolicy';
import { resolveEmployeeGlobalSchedule } from '@/lib/hr/employeeBranchScheduleResolver';
import { canBranchAppearInPublicBooking } from '@/lib/branch/publicBranchVisibility';
import { getBranchById } from '@/lib/branch/repository';
import { getPublicSettings, isValidDate } from '@/lib/publicBookingHelpers';
import { getCairoBusinessDate } from '@/lib/businessDate';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';
import {
  ensureTblEmpImageUrlColumn,
  tblEmpImageUrlSelect,
} from '@/lib/migrations/ensureEmployeeImageUrl';
import {
  ensureTblEmpNameEnColumn,
  normalizeEmpNameEn,
  tblEmpNameEnSelect,
} from '@/lib/migrations/ensureEmployeeNameEn';
import {
  coerceDisplaySortOrder,
  ensureTblEmpDisplaySortOrderColumn,
  tblEmpDisplaySortOrderSelect,
} from '@/lib/migrations/ensureEmployeeDisplaySortOrder';
import { getBarberNameEnByArabicName } from '@/lib/barberImages';

export {
  isEmployeeEligibleForPublicBooking,
  evaluateEmployeePublicBookingEligibility,
} from '@/lib/booking/publicBookingBarberPolicy';

const CACHE_TTL_MS = 45_000;
const CACHE_MAX = 32;
const cacheRootKey = '__pos_public_booking_barbers_v4';

type CacheEntry = { expiresAt: number; value: unknown };

function getCacheMap(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & {
    [cacheRootKey]?: Map<string, CacheEntry>;
  };
  if (!g[cacheRootKey]) g[cacheRootKey] = new Map();
  return g[cacheRootKey]!;
}

export function invalidatePublicBookingBarbersCache(): void {
  getCacheMap().clear();
}

/** Also clear service cache when shared catalog versioning matters. */
export function invalidatePublicBookingBarberRelatedCaches(): void {
  invalidatePublicBookingBarbersCache();
  invalidatePublicBookingServicesCache();
}

function cacheGet<T>(key: string): T | null {
  const hit = getCacheMap().get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  const map = getCacheMap();
  if (map.size >= CACHE_MAX) {
    const first = map.keys().next().value;
    if (first) map.delete(first);
  }
  map.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

export class PublicBookingBarberError extends Error {
  readonly code: PublicBookingErrorCode;
  constructor(code: PublicBookingErrorCode) {
    super(code);
    this.name = 'PublicBookingBarberError';
    this.code = code;
  }
}

export type PublicBarberBranchWire = {
  branchCode: string;
  branchName: string;
};

export type PublicBarberWire = {
  empId: number;
  /** Legacy alias */
  id: number;
  nameAr: string;
  nameEn: string | null;
  /** Legacy display name */
  name: string;
  imageUrl: string | null;
  shortBio: string | null;
  photoUrl: string | null;
  bio: string | null;
  /** Lower = earlier in client lists (admin-controlled via employees page). */
  displaySortOrder: number;
  serviceIds: number[];
  branches: PublicBarberBranchWire[];
  availabilityType: 'presence_only';
  isBookableOnline: true;
};

export type PublicBarbersListResponse = {
  ok: true;
  mode: 'global' | 'branch';
  branch?: { branchCode: string; branchName: string };
  barbers: PublicBarberWire[];
  meta: {
    count: number;
    generatedAt: string;
    contractVersion: string;
    dateFilter: string | null;
  };
};

export type PublicBarberCalendarDayWire = {
  date: string;
  status: PublicBarberCalendarStatus;
  isWorking: boolean;
  isBookableCandidate: boolean;
  /** Legacy aliases */
  isPresent: boolean;
  isBookable: boolean;
  availableSlotCount?: number;
  firstAvailableTime?: string | null;
  firstAvailableDayOffset?: 0 | 1 | null;
  branches: Array<{
    branchCode: string;
    branchName: string;
    startTime: string | null;
    endTime: string | null;
    startDayOffset: 0 | 1;
    endDayOffset: 0 | 1;
  }>;
};

export type PublicBarberCalendarResponse = {
  ok: true;
  barber: {
    empId: number;
    nameAr: string;
    nameEn: string | null;
    name: string;
    imageUrl: string | null;
  };
  from: string;
  to: string;
  presenceOnly: boolean;
  days: PublicBarberCalendarDayWire[];
};

export type PublicBarberLocationResponse = {
  ok: true;
  barber: { empId: number; nameAr: string; name: string };
  date: string;
  isWorking: boolean;
  status: PublicBarberCalendarStatus;
  branch: {
    branchCode: string;
    branchName: string;
    address: string | null;
    phone: string | null;
  } | null;
  schedule: {
    startTime: string | null;
    endTime: string | null;
    endDayOffset: 0 | 1;
  } | null;
  reason?: string;
};

type CandidateRow = {
  EmpID: number;
  EmpName: string;
  EmpNameEn: string | null;
  Job: string | null;
  ImageUrl: string | null;
  DisplaySortOrder: number;
  BranchID: number;
  BranchCode: string;
  BranchName: string;
  CanReceiveBookings: boolean | number;
  IsActiveAssign: boolean | number;
};

async function loadPublicServiceIds(): Promise<number[]> {
  // Use GLEEM as catalog host when public — prices/services are global.
  let ctx: PublicBookingBranchContext;
  try {
    ctx = await resolvePublicBookingBranchContext({
      branchCode: 'GLEEM',
      purpose: 'public_booking',
    });
  } catch {
    // No public branch → empty catalog
    return [];
  }
  const catalog = await getPublicBookingServicesCatalog(ctx);
  return catalog.services.map((s) => s.serviceId);
}

async function assertRequestedServicesPublic(serviceIds: number[]): Promise<number[]> {
  if (!serviceIds.length) return [];
  const publicIds = new Set(await loadPublicServiceIds());
  for (const id of serviceIds) {
    if (!publicIds.has(id)) {
      throw new PublicBookingBarberError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
    }
  }
  return serviceIds;
}

function resolvePublicBarberNameEn(
  dbNameEn: string | null | undefined,
  nameAr: string,
): string | null {
  return normalizeEmpNameEn(dbNameEn) ?? getBarberNameEnByArabicName(nameAr);
}

async function loadAssignmentCandidates(day: string): Promise<CandidateRow[]> {
  const db = await getPool();
  const hasImageUrl = await ensureTblEmpImageUrlColumn(db);
  const hasNameEn = await ensureTblEmpNameEnColumn(db);
  const hasSort = await ensureTblEmpDisplaySortOrderColumn(db);
  const imageUrlCol = tblEmpImageUrlSelect(hasImageUrl);
  const nameEnCol = tblEmpNameEnSelect(hasNameEn);
  const sortCol = tblEmpDisplaySortOrderSelect(hasSort);
  const orderBySort = hasSort
    ? 'ISNULL(e.DisplaySortOrder, 999),'
    : '';
  const res = await db.request().input('day', sql.Date, day).query(`
    SELECT
      e.EmpID, e.EmpName, e.Job,
      ${imageUrlCol},
      ${nameEnCol},
      ${sortCol},
      b.BranchID, b.BranchCode, b.BranchName,
      a.CanReceiveBookings,
      a.IsActive AS IsActiveAssign
    FROM dbo.TblEmp e
    INNER JOIN dbo.TblEmpBranchAssignment a ON a.EmpID = e.EmpID
    INNER JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE ISNULL(e.isActive, 1) = 1
      AND e.Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
      AND a.IsActive = 1
      AND a.CanReceiveBookings = 1
      AND a.EffectiveFrom <= @day
      AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @day)
      ${excludeTestSmokeSqlPredicate()}
    ORDER BY ${orderBySort} e.EmpName, e.EmpID, b.BranchCode
  `);
  return res.recordset as CandidateRow[];
}

async function loadPublicEmployeeOrThrow(empId: number): Promise<{
  empId: number;
  name: string;
  nameEn: string | null;
  imageUrl: string | null;
}> {
  if (!Number.isFinite(empId) || empId <= 0) {
    throw new PublicBookingBarberError('BARBER_NOT_FOUND');
  }
  const db = await getPool();
  const hasImageUrl = await ensureTblEmpImageUrlColumn(db);
  const hasNameEn = await ensureTblEmpNameEnColumn(db);
  const imageSelect = hasImageUrl
    ? 'ImageUrl'
    : 'CAST(NULL AS NVARCHAR(1000)) AS ImageUrl';
  const nameEnSelect = hasNameEn
    ? 'EmpNameEn'
    : 'CAST(NULL AS NVARCHAR(200)) AS EmpNameEn';
  const res = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`
      SELECT EmpID, EmpName, ISNULL(isActive, 1) AS isActive, Job, ${imageSelect}, ${nameEnSelect}
      FROM dbo.TblEmp WHERE EmpID = @empId
    `);
  const row = res.recordset[0];
  if (!row) throw new PublicBookingBarberError('BARBER_NOT_FOUND');
  if (!isEmployeeActive(row.isActive) || isEmployeeHiddenFromPublicBooking(row.EmpName)) {
    throw new PublicBookingBarberError('BARBER_NOT_FOUND');
  }
  if (!isBarberJob(row.Job)) {
    throw new PublicBookingBarberError('BARBER_NOT_FOUND');
  }
  // Must have at least one public-bookable assignment historically/currently
  const day = getCairoBusinessDate();
  const candidates = await loadAssignmentCandidates(day);
  const mine = candidates.filter((c) => Number(c.EmpID) === empId);
  let anyPublic = false;
  for (const c of mine) {
    if (await canBranchAppearInPublicBooking(Number(c.BranchID))) {
      anyPublic = true;
      break;
    }
  }
  if (!anyPublic) {
    throw new PublicBookingBarberError('BARBER_NOT_FOUND');
  }
  const name = String(row.EmpName);
  return {
    empId,
    name,
    nameEn: resolvePublicBarberNameEn(row.EmpNameEn, name),
    imageUrl: resolveBarberPublicImageUrl(row.ImageUrl, name),
  };
}

function toWireBarber(args: {
  empId: number;
  name: string;
  nameEn?: string | null;
  serviceIds: number[];
  branches: PublicBarberBranchWire[];
  imageUrl?: string | null;
  displaySortOrder?: number | null;
}): PublicBarberWire {
  const nameAr = args.name;
  const nameEn = resolvePublicBarberNameEn(args.nameEn, nameAr);
  const imageUrl = resolveBarberPublicImageUrl(args.imageUrl, nameAr);
  const displaySortOrder = coerceDisplaySortOrder(args.displaySortOrder);
  return {
    empId: args.empId,
    id: args.empId,
    nameAr,
    nameEn,
    name: nameAr,
    imageUrl,
    shortBio: null,
    photoUrl: imageUrl,
    bio: null,
    displaySortOrder,
    serviceIds: args.serviceIds,
    branches: args.branches,
    availabilityType: 'presence_only',
    isBookableOnline: true,
  };
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function listPublicBookingBarbers(args: {
  mode: 'global' | 'branch';
  branchCode?: string | null;
  date?: string | null;
  serviceIds?: number[];
  previewQueryParam?: string | null;
}): Promise<PublicBarbersListResponse> {
  const serviceIds = await assertRequestedServicesPublic(args.serviceIds ?? []);
  const publicServiceIds = await loadPublicServiceIds();
  if (publicServiceIds.length === 0) {
    throw new PublicBookingBarberError('SERVICES_NOT_CONFIGURED');
  }

  const dateFilter =
    args.date && isValidDate(args.date) ? args.date : null;
  const rosterDay = dateFilter ?? getCairoBusinessDate();

  let branchCtx: PublicBookingBranchContext | null = null;
  if (args.mode === 'branch') {
    if (!args.branchCode) {
      throw new PublicBookingBarberError('BRANCH_REQUIRED');
    }
    try {
      branchCtx = await resolvePublicBookingBranchContext({
        branchCode: args.branchCode,
        purpose: 'public_booking',
        previewQueryParam: args.previewQueryParam,
      });
    } catch (err) {
      if (err instanceof PublicBookingBranchContextError) {
        throw new PublicBookingBarberError(err.code);
      }
      throw err;
    }
    if (!branchCtx.bookingEnabled || !branchCtx.publicBookingEnabled) {
      throw new PublicBookingBarberError('BRANCH_BOOKING_DISABLED');
    }
  } else if (args.previewQueryParam) {
    // preview must never escalate
  }

  const cacheKey = [
    args.mode,
    branchCtx?.branchCode ?? 'GLOBAL',
    dateFilter ?? 'NO_DATE',
    serviceIds.join(',') || 'ALL',
    PUBLIC_BOOKING_BARBER_CONTRACT_VERSION,
    publicServiceIds.length,
  ].join('::');
  const cached = cacheGet<PublicBarbersListResponse>(cacheKey);
  if (cached) return cached;

  const candidates = await loadAssignmentCandidates(rosterDay);
  const byEmp = new Map<
    number,
    {
      empId: number;
      name: string;
      nameEn: string | null;
      imageUrl: string | null;
      displaySortOrder: number;
      branches: PublicBarberBranchWire[];
      branchIds: number[];
    }
  >();

  const branchVisibility = new Map<number, boolean>();
  const isBranchPublic = async (branchId: number) => {
    const cached = branchVisibility.get(branchId);
    if (cached != null) return cached;
    const ok = await canBranchAppearInPublicBooking(branchId);
    branchVisibility.set(branchId, ok);
    return ok;
  };

  for (const row of candidates) {
    const branchId = Number(row.BranchID);
    if (!(await isBranchPublic(branchId))) continue;
    if (branchCtx && branchId !== branchCtx.branchId) continue;

    const empId = Number(row.EmpID);
    const elig = evaluateEmployeePublicBookingEligibility({
      employee: { empId, name: row.EmpName, isActive: true, job: row.Job },
      branchAssignment: {
        branchId,
        branchCode: String(row.BranchCode),
        branchName: String(row.BranchName),
        isActive: true,
        canReceiveBookings: true,
      },
      branchIsPubliclyBookable: true,
      publicServiceCount: publicServiceIds.length,
      requestedServicesOk: true,
    });
    if (!elig.eligible) continue;

    let entry = byEmp.get(empId);
    if (!entry) {
      entry = {
        empId,
        name: String(row.EmpName),
        nameEn: row.EmpNameEn ?? null,
        imageUrl: row.ImageUrl ?? null,
        displaySortOrder: coerceDisplaySortOrder(row.DisplaySortOrder),
        branches: [],
        branchIds: [],
      };
      byEmp.set(empId, entry);
    }
    if (!entry.branches.some((b) => b.branchCode === String(row.BranchCode))) {
      entry.branches.push({
        branchCode: String(row.BranchCode),
        branchName: String(row.BranchName),
      });
      entry.branchIds.push(branchId);
    }
  }

  let barbers: PublicBarberWire[] = [];

  for (const entry of byEmp.values()) {
    if (dateFilter) {
      const global = await resolveEmployeeGlobalSchedule({
        empId: entry.empId,
        workDate: dateFilter,
        publicOnly: true,
        allowedBranchIds: branchCtx ? [branchCtx.branchId] : undefined,
      });
      if (global.isGlobalDayOff || !global.isGloballyWorking) continue;
      const workingPublic = global.branches.filter((b) => b.isWorking);
      if (!workingPublic.length) continue;
      if (branchCtx) {
        const atBranch = workingPublic.find((b) => b.branchId === branchCtx!.branchId);
        if (!atBranch) continue;
        entry.branches = [
          { branchCode: atBranch.branchCode, branchName: atBranch.branchName },
        ];
      } else {
        entry.branches = workingPublic.map((b) => ({
          branchCode: b.branchCode,
          branchName: b.branchName,
        }));
      }
    }

    const wire = toWireBarber({
      empId: entry.empId,
      name: entry.name,
      nameEn: entry.nameEn,
      imageUrl: entry.imageUrl,
      displaySortOrder: entry.displaySortOrder,
      serviceIds: serviceIds.length ? serviceIds : publicServiceIds,
      branches: entry.branches,
    });
    barbers.push(wire);
  }

  barbers = dedupeBarbersByEmpId(barbers).sort((a, b) =>
    comparePublicBarbers(
      {
        displaySortOrder: a.displaySortOrder,
        isFeatured: false,
        nameAr: a.nameAr,
        empId: a.empId,
      },
      {
        displaySortOrder: b.displaySortOrder,
        isFeatured: false,
        nameAr: b.nameAr,
        empId: b.empId,
      },
    ),
  );

  const response: PublicBarbersListResponse = {
    ok: true,
    mode: args.mode,
    ...(branchCtx
      ? {
          branch: {
            branchCode: branchCtx.branchCode,
            branchName: branchCtx.branchName,
          },
        }
      : {}),
    barbers,
    meta: {
      count: barbers.length,
      generatedAt: new Date().toISOString(),
      contractVersion: PUBLIC_BOOKING_BARBER_CONTRACT_VERSION,
      dateFilter,
    },
  };
  cacheSet(cacheKey, response);
  return response;
}

async function classifyCalendarDay(args: {
  empId: number;
  date: string;
  branchFilterId: number | null;
  horizonEnd: string;
  serviceIds: number[];
}): Promise<PublicBarberCalendarDayWire> {
  if (isOutsideBookingHorizon(args.date, args.horizonEnd)) {
    return {
      date: args.date,
      status: 'outside_booking_horizon',
      isWorking: false,
      isBookableCandidate: false,
      isPresent: false,
      isBookable: false,
      branches: [],
    };
  }

  if (args.serviceIds.length) {
    // Already validated as public; all barbers can perform — still presence_only
  }

  const publicGlobal = await resolveEmployeeGlobalSchedule({
    empId: args.empId,
    workDate: args.date,
    allowedBranchIds: args.branchFilterId != null ? [args.branchFilterId] : undefined,
    publicOnly: true,
  });

  if (publicGlobal.isGlobalDayOff) {
    return {
      date: args.date,
      status: 'global_leave',
      isWorking: false,
      isBookableCandidate: false,
      isPresent: false,
      isBookable: false,
      branches: [],
    };
  }

  const working = publicGlobal.branches.filter((b) => b.isWorking);
  if (working.length > 0) {
    return {
      date: args.date,
      status: 'presence_only',
      isWorking: true,
      isBookableCandidate: true,
      isPresent: true,
      isBookable: false,
      branches: working.map((b) => ({
        branchCode: b.branchCode,
        branchName: b.branchName,
        startTime: b.startTime,
        endTime: b.endTime,
        startDayOffset: b.startDayOffset,
        endDayOffset: b.endDayOffset,
      })),
    };
  }

  // Privacy: working only at non-public branch?
  if (args.branchFilterId == null) {
    const privateGlobal = await resolveEmployeeGlobalSchedule({
      empId: args.empId,
      workDate: args.date,
      publicOnly: false,
    });
    if (privateGlobal.isGlobalDayOff) {
      return {
        date: args.date,
        status: 'global_leave',
        isWorking: false,
        isBookableCandidate: false,
        isPresent: false,
        isBookable: false,
        branches: [],
      };
    }
    const privateWorking = privateGlobal.branches.filter((b) => b.isWorking);
    if (privateWorking.length > 0) {
      // Do not leak Camp Caesar / internal destination
      return {
        date: args.date,
        status: 'not_available_publicly',
        isWorking: false,
        isBookableCandidate: false,
        isPresent: false,
        isBookable: false,
        branches: [],
      };
    }
  }

  return {
    date: args.date,
    status: 'day_off',
    isWorking: false,
    isBookableCandidate: false,
    isPresent: false,
    isBookable: false,
    branches: [],
  };
}

export async function getPublicBarberCalendar(args: {
  empId: number;
  from: string;
  to: string;
  branchCode?: string | null;
  serviceIds?: number[];
  previewQueryParam?: string | null;
}): Promise<PublicBarberCalendarResponse> {
  if (!isValidDate(args.from) || !isValidDate(args.to)) {
    throw new PublicBookingBarberError('INVALID_DATE');
  }
  if (args.from > args.to) {
    throw new PublicBookingBarberError('INVALID_DATE_RANGE');
  }
  const span = inclusiveDaySpan(args.from, args.to);
  if (span < 0 || span > MAX_PUBLIC_BARBER_CALENDAR_DAYS) {
    throw new PublicBookingBarberError('DATE_RANGE_TOO_LARGE');
  }

  const serviceIds = await assertRequestedServicesPublic(args.serviceIds ?? []);
  const emp = await loadPublicEmployeeOrThrow(args.empId);

  let branchFilterId: number | null = null;
  let settingsBranchId = 1;
  if (args.branchCode) {
    let ctx: PublicBookingBranchContext;
    try {
      ctx = await resolvePublicBookingBranchContext({
        branchCode: args.branchCode,
        purpose: 'public_booking',
        previewQueryParam: args.previewQueryParam,
      });
    } catch (err) {
      if (err instanceof PublicBookingBranchContextError) {
        throw new PublicBookingBarberError(err.code);
      }
      throw err;
    }
    branchFilterId = ctx.branchId;
    settingsBranchId = ctx.branchId;
  } else {
    try {
      const gleem = await resolvePublicBookingBranchContext({
        branchCode: 'GLEEM',
        purpose: 'public_booking',
      });
      settingsBranchId = gleem.branchId;
    } catch {
      /* keep 1 */
    }
  }

  const settings = await getPublicSettings(settingsBranchId);
  const horizonEnd = addDaysYmd(getCairoBusinessDate(), settings.maxBookingDaysAhead);

  const cacheKey = [
    'cal',
    args.empId,
    args.from,
    args.to,
    branchFilterId ?? 'ALL',
    serviceIds.join(','),
    horizonEnd,
    PUBLIC_BOOKING_BARBER_CONTRACT_VERSION,
  ].join('::');
  const cached = cacheGet<PublicBarberCalendarResponse>(cacheKey);
  if (cached) return cached;

  const days: PublicBarberCalendarDayWire[] = [];
  for (const date of eachDateInclusive(args.from, args.to)) {
    let day = await classifyCalendarDay({
      empId: args.empId,
      date,
      branchFilterId,
      horizonEnd,
      serviceIds,
    });

    if (serviceIds.length && day.isWorking && day.branches[0]) {
      const { enrichCalendarDayAvailability } = await import(
        '@/lib/booking/publicBookingAvailability'
      );
      const enriched = await enrichCalendarDayAvailability({
        branchCode: day.branches[0].branchCode,
        empId: args.empId,
        date,
        serviceIds,
        baseStatus: day.status,
        isWorking: true,
      });
      day = {
        ...day,
        status: enriched.status as PublicBarberCalendarStatus,
        availableSlotCount: enriched.availableSlotCount,
        firstAvailableTime: enriched.firstAvailableTime,
        firstAvailableDayOffset: enriched.firstAvailableDayOffset,
        isBookableCandidate: enriched.isBookableCandidate,
        isBookable: enriched.isBookableCandidate,
      };
    }

    days.push(day);
  }

  const response: PublicBarberCalendarResponse = {
    ok: true,
    barber: {
      empId: emp.empId,
      nameAr: emp.name,
      nameEn: emp.nameEn,
      name: emp.name,
      imageUrl: emp.imageUrl,
    },
    from: args.from,
    to: args.to,
    presenceOnly: serviceIds.length === 0,
    days,
  };
  cacheSet(cacheKey, response);
  return response;
}

export async function getPublicBarberLocation(args: {
  empId: number;
  date: string;
  serviceIds?: number[];
  previewQueryParam?: string | null;
}): Promise<PublicBarberLocationResponse> {
  if (!isValidDate(args.date)) {
    throw new PublicBookingBarberError('INVALID_DATE');
  }

  const locKey = [
    'location',
    args.empId,
    args.date,
    (args.serviceIds ?? []).join(',') || 'ALL',
  ].join('::');
  const locCached = cacheGet<PublicBarberLocationResponse>(locKey);
  if (locCached) return locCached;

  await assertRequestedServicesPublic(args.serviceIds ?? []);
  const emp = await loadPublicEmployeeOrThrow(args.empId);

  if (args.previewQueryParam) {
    // ignored — never escalates
  }

  const day = await classifyCalendarDay({
    empId: args.empId,
    date: args.date,
    branchFilterId: null,
    horizonEnd: addDaysYmd(getCairoBusinessDate(), 365),
    serviceIds: args.serviceIds ?? [],
  });

  if (!day.isWorking || !day.branches[0]) {
    const off: PublicBarberLocationResponse = {
      ok: true,
      barber: { empId: emp.empId, nameAr: emp.name, name: emp.name },
      date: args.date,
      isWorking: false,
      status: day.status,
      branch: null,
      schedule: null,
      reason: day.status,
    };
    cacheSet(locKey, off);
    return off;
  }

  const br = day.branches[0];
  const global = await resolveEmployeeGlobalSchedule({
    empId: args.empId,
    workDate: args.date,
    publicOnly: true,
  });
  const resolved = global.branches.find((b) => b.branchCode === br.branchCode);
  const full = resolved ? await getBranchById(resolved.branchId) : null;

  const value: PublicBarberLocationResponse = {
    ok: true,
    barber: { empId: emp.empId, nameAr: emp.name, name: emp.name },
    date: args.date,
    isWorking: true,
    status: 'presence_only',
    branch: {
      branchCode: br.branchCode,
      branchName: br.branchName,
      address: full?.address ?? null,
      phone: full?.phone ?? null,
    },
    schedule: {
      startTime: br.startTime,
      endTime: br.endTime,
      endDayOffset: br.endDayOffset,
    },
  };
  cacheSet(locKey, value);
  return value;
}

/**
 * Single-barber public profile — avoids shipping the full global roster.
 */
export async function getPublicBarberProfileById(args: {
  empId: number;
  previewQueryParam?: string | null;
}): Promise<{
  ok: true;
  barber: PublicBarberWire;
  meta: { generatedAt: string; contractVersion: string };
}> {
  void args.previewQueryParam;
  const cacheKey = `profile::${args.empId}::${PUBLIC_BOOKING_BARBER_CONTRACT_VERSION}`;
  const cached = cacheGet<{
    ok: true;
    barber: PublicBarberWire;
    meta: { generatedAt: string; contractVersion: string };
  }>(cacheKey);
  if (cached) return cached;

  const emp = await loadPublicEmployeeOrThrow(args.empId);
  const publicServiceIds = await loadPublicServiceIds();
  if (publicServiceIds.length === 0) {
    throw new PublicBookingBarberError('SERVICES_NOT_CONFIGURED');
  }

  const day = getCairoBusinessDate();
  const candidates = await loadAssignmentCandidates(day);
  const branches: PublicBarberBranchWire[] = [];
  const seen = new Set<string>();
  for (const row of candidates) {
    if (Number(row.EmpID) !== args.empId) continue;
    const branchId = Number(row.BranchID);
    if (!(await canBranchAppearInPublicBooking(branchId))) continue;
    const code = String(row.BranchCode);
    if (seen.has(code)) continue;
    seen.add(code);
    branches.push({
      branchCode: code,
      branchName: String(row.BranchName),
    });
  }

  if (!branches.length) {
    throw new PublicBookingBarberError('BARBER_NOT_FOUND');
  }

  const nameEn = emp.nameEn ?? getBarberNameEnByArabicName(emp.name);
  const imageUrl = resolveBarberPublicImageUrl(emp.imageUrl, emp.name);

  const barber: PublicBarberWire = {
    empId: emp.empId,
    id: emp.empId,
    nameAr: emp.name,
    nameEn,
    name: emp.name,
    imageUrl,
    shortBio: null,
    photoUrl: imageUrl,
    bio: null,
    serviceIds: publicServiceIds,
    branches,
    availabilityType: 'presence_only',
    isBookableOnline: true,
  };

  const value = {
    ok: true as const,
    barber,
    meta: {
      generatedAt: new Date().toISOString(),
      contractVersion: PUBLIC_BOOKING_BARBER_CONTRACT_VERSION,
    },
  };
  cacheSet(cacheKey, value);
  return value;
}

/** Pure helper exported for tests — assemble wire from rows. */
export function assemblePublicBarbersFromCandidates(
  rows: Array<{
    empId: number;
    name: string;
    nameEn?: string | null;
    branchCode: string;
    branchName: string;
    imageUrl?: string | null;
    displaySortOrder?: number | null;
  }>,
  serviceIds: number[],
): PublicBarberWire[] {
  const byEmp = new Map<number, PublicBarberWire>();
  for (const row of rows) {
    let entry = byEmp.get(row.empId);
    if (!entry) {
      entry = toWireBarber({
        empId: row.empId,
        name: row.name,
        nameEn: row.nameEn,
        imageUrl: row.imageUrl,
        displaySortOrder: row.displaySortOrder,
        serviceIds,
        branches: [],
      });
      byEmp.set(row.empId, entry);
    }
    if (!entry.branches.some((b) => b.branchCode === row.branchCode)) {
      entry.branches.push({
        branchCode: row.branchCode,
        branchName: row.branchName,
      });
    }
  }
  return dedupeBarbersByEmpId([...byEmp.values()]).sort((a, b) =>
    comparePublicBarbers(
      {
        displaySortOrder: a.displaySortOrder,
        isFeatured: false,
        nameAr: a.nameAr,
        empId: a.empId,
      },
      {
        displaySortOrder: b.displaySortOrder,
        isFeatured: false,
        nameAr: b.nameAr,
        empId: b.empId,
      },
    ),
  );
}
