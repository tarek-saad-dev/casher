/**
 * Booking Phase 5 — canonical public booking selection evaluator.
 * Shared by check-slot and plan (create_precheck reserved for Phase 6).
 *
 * Strong/fresh busy evaluation: never reads Phase-4 final-slot cache.
 */
import 'server-only';
import {
  PublicBookingBranchContextError,
  resolvePublicBookingBranchContext,
  type InternalPreviewAuth,
  type PublicBookingBranchContext,
  type PublicBookingPurpose,
} from '@/lib/booking/publicBookingBranchContext';
import {
  BookingServiceDurationError,
  resolveSelectedBookingServices,
  type ResolvedBookingServiceLine,
} from '@/lib/booking/bookingServiceDuration';
import {
  PUBLIC_BOOKING_ERROR_CATALOG,
  type PublicBookingErrorCode,
} from '@/lib/booking/publicBookingErrorCatalog';
import { isOutsideBookingHorizon, resolveBarberPublicImageUrl, comparePublicBarbers } from '@/lib/booking/publicBookingBarberPolicy';
import {
  listAvailableBookingSlots,
  validateBookingSlot,
  type BookingSlotReasonCode,
} from '@/lib/bookingAvailabilityEngine';
import { resolveEmployeeBranchSchedule, resolveEmployeeGlobalSchedule } from '@/lib/hr/employeeBranchScheduleResolver';
import { getPublicSettings, isValidDate, isValidTime, salonDateTimeToMs } from '@/lib/publicBookingHelpers';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { isEmployeeHiddenFromPublicBooking } from '@/lib/hr/testEmployeePolicy';
import { getPool, sql } from '@/lib/db';
import { canBranchAppearInPublicBooking } from '@/lib/branch/publicBranchVisibility';
import {
  BOOKING_PLAN_CONTRACT_VERSION,
  mintPlanFingerprint,
} from '@/lib/booking/publicBookingPlanFingerprint';
import {
  ensureTblEmpImageUrlColumn,
} from '@/lib/migrations/ensureEmployeeImageUrl';
import {
  ensureTblEmpNameEnColumn,
  normalizeEmpNameEn,
} from '@/lib/migrations/ensureEmployeeNameEn';
import {
  coerceDisplaySortOrder,
  ensureTblEmpDisplaySortOrderColumn,
} from '@/lib/migrations/ensureEmployeeDisplaySortOrder';
import { getBarberNameEnByArabicName } from '@/lib/barberImages';

export type PublicSelectionPurpose = 'check_slot' | 'plan' | 'create_precheck' | 'internal_preview';
export type PublicSelectionMode = 'specific_barber' | 'any_barber';
export type AssignmentStrategy = 'fixed_barber' | 'server_select_on_create';

export class PublicBookingSelectionError extends Error {
  readonly code: PublicBookingErrorCode;
  readonly metadata: Record<string, unknown>;
  constructor(code: PublicBookingErrorCode, metadata: Record<string, unknown> = {}) {
    super(code);
    this.name = 'PublicBookingSelectionError';
    this.code = code;
    this.metadata = metadata;
  }
}

export type PublicCandidateBarber = {
  empId: number;
  nameAr: string;
  nameEn: string | null;
  imageUrl: string | null;
  displaySortOrder?: number;
};

export type PublicSelectionEvaluation = {
  branchContext: PublicBookingBranchContext;
  mode: PublicSelectionMode;
  assignmentStrategy: AssignmentStrategy;
  workDate: string;
  requestedTime: string;
  requestedDayOffset: 0 | 1;
  startDateTime: string | null;
  endDateTime: string | null;
  selectedServices: ResolvedBookingServiceLine[];
  totalDurationMinutes: number;
  subtotal: number;
  pricingScope: 'global';
  specificBarber: PublicCandidateBarber | null;
  candidateBarbers: PublicCandidateBarber[];
  available: boolean;
  availabilityCode: PublicBookingErrorCode | null;
  availabilityMessage: string | null;
  safeMetadata: Record<string, unknown>;
  evaluatedAt: string;
  purpose: PublicSelectionPurpose;
  /** Present when available (plan/create_precheck consumers). */
  planFingerprint: string | null;
  planToken: string | null;
  planExpiresAt: string | null;
  contractVersion: string;
  /** Fresh evaluation — never served from Phase-4 slot cache. */
  evaluationMode: 'strong_fresh';
};

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextDate(ymd: string): string {
  return addDaysYmd(ymd, 1);
}

function mapDurationError(err: BookingServiceDurationError): PublicBookingErrorCode {
  if (err.code === 'SERVICES_NOT_CONFIGURED') return 'SERVICES_NOT_CONFIGURED';
  return 'SERVICE_NOT_AVAILABLE_AT_BRANCH';
}

function mapEngineReason(code: BookingSlotReasonCode | undefined): PublicBookingErrorCode {
  switch (code) {
    case 'minimum_notice':
    case 'past':
      return 'MIN_NOTICE_NOT_MET';
    case 'outside_working_hours':
      return 'SLOT_OUTSIDE_BRANCH_HOURS';
    case 'insufficient_continuous_time':
      return 'SLOT_OUTSIDE_BRANCH_HOURS';
    case 'queue_conflict':
    case 'booking_conflict':
    case 'break':
      return 'SLOT_UNAVAILABLE';
    case 'barber_unavailable':
      return 'BARBER_DAY_OFF';
    default:
      return 'SLOT_UNAVAILABLE';
  }
}

function normalizeMode(
  rawMode: unknown,
  empId: number | null,
): PublicSelectionMode {
  const m = typeof rawMode === 'string' ? rawMode.trim().toLowerCase() : '';
  if (m === 'specific_barber' || m === 'specific') {
    if (!empId) throw new PublicBookingSelectionError('BARBER_NOT_FOUND');
    return 'specific_barber';
  }
  if (m === 'any_barber' || m === 'nearest' || m === '') {
    if (empId) return 'specific_barber';
    return 'any_barber';
  }
  // Unknown mode: infer from empId
  return empId ? 'specific_barber' : 'any_barber';
}

function parseEmpId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new PublicBookingSelectionError('BARBER_NOT_FOUND');
  }
  return n;
}

function parseDayOffset(raw: unknown): 0 | 1 {
  if (raw === undefined || raw === null || raw === '') {
    throw new PublicBookingSelectionError('INVALID_DAY_OFFSET');
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 0) return 0;
  if (n === 1) return 1;
  throw new PublicBookingSelectionError('INVALID_DAY_OFFSET');
}

async function loadEmpPublicIdentity(
  empId: number,
): Promise<{ nameAr: string; nameEn: string | null; imageUrl: string | null } | null> {
  const db = await getPool();
  const hasImageUrl = await ensureTblEmpImageUrlColumn(db);
  const hasNameEn = await ensureTblEmpNameEnColumn(db);
  const imageSelect = hasImageUrl
    ? 'ImageUrl'
    : 'CAST(NULL AS NVARCHAR(1000)) AS ImageUrl';
  const nameEnSelect = hasNameEn
    ? 'EmpNameEn'
    : 'CAST(NULL AS NVARCHAR(200)) AS EmpNameEn';
  const r = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`
      SELECT EmpName, ISNULL(isActive,1) AS isActive, ${imageSelect}, ${nameEnSelect}
      FROM dbo.TblEmp WHERE EmpID=@empId
    `);
  const row = r.recordset[0];
  if (!row || !row.isActive) return null;
  if (isEmployeeHiddenFromPublicBooking(row.EmpName)) return null;
  const nameAr = String(row.EmpName);
  return {
    nameAr,
    nameEn: normalizeEmpNameEn(row.EmpNameEn) ?? getBarberNameEnByArabicName(nameAr),
    imageUrl: resolveBarberPublicImageUrl(row.ImageUrl, nameAr),
  };
}

async function loadEmpDisplaySortOrders(
  empIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const unique = [...new Set(empIds.filter((id) => Number.isInteger(id) && id > 0))];
  for (const id of unique) map.set(id, 999);
  if (!unique.length) return map;

  const db = await getPool();
  const hasCol = await ensureTblEmpDisplaySortOrderColumn(db);
  if (!hasCol) return map;

  const req = db.request();
  const placeholders = unique
    .map((id, i) => {
      req.input(`e${i}`, sql.Int, id);
      return `@e${i}`;
    })
    .join(',');
  const res = await req.query(`
    SELECT EmpID, DisplaySortOrder
    FROM dbo.TblEmp
    WHERE EmpID IN (${placeholders})
  `);
  for (const row of res.recordset) {
    map.set(Number(row.EmpID), coerceDisplaySortOrder(row.DisplaySortOrder));
  }
  return map;
}

async function classifySpecificBarberDay(args: {
  empId: number;
  branchCtx: PublicBookingBranchContext;
  date: string;
  purpose?: PublicSelectionPurpose;
}): Promise<PublicBookingErrorCode | 'not_available_publicly' | null> {
  // Internal smoke/verifier: allow booking at the requested branch when the emp is
  // working there, even if the branch is not publicly discoverable.
  if (args.purpose === 'internal_preview') {
    const atBranch = await resolveEmployeeBranchSchedule({
      empId: args.empId,
      branchId: args.branchCtx.branchId,
      workDate: args.date,
    });
    if (atBranch?.isWorking) return null;

    const global = await resolveEmployeeGlobalSchedule({
      empId: args.empId,
      workDate: args.date,
      publicOnly: false,
    });
    if (global.isGlobalDayOff) return 'BARBER_DAY_OFF';
    const other = global.branches.find((b) => b.isWorking && b.branchId !== args.branchCtx.branchId);
    if (other) return 'BARBER_AVAILABLE_AT_DIFFERENT_BRANCH';
    return 'BARBER_DAY_OFF';
  }

  const global = await resolveEmployeeGlobalSchedule({
    empId: args.empId,
    workDate: args.date,
    publicOnly: false,
  });
  if (global.isGlobalDayOff) return 'BARBER_DAY_OFF';

  const publicWorking = (
    await resolveEmployeeGlobalSchedule({
      empId: args.empId,
      workDate: args.date,
      publicOnly: true,
    })
  ).branches.filter((b) => b.isWorking);

  const atBranch = publicWorking.find((b) => b.branchId === args.branchCtx.branchId);
  if (atBranch) return null;

  const otherPublic = publicWorking[0];
  if (otherPublic) return 'BARBER_AVAILABLE_AT_DIFFERENT_BRANCH';

  const privateWorking = global.branches.filter((b) => b.isWorking);
  if (privateWorking.length) {
    const dest = privateWorking[0];
    if (await canBranchAppearInPublicBooking(dest.branchId)) {
      return 'BARBER_AVAILABLE_AT_DIFFERENT_BRANCH';
    }
    return 'not_available_publicly';
  }
  return 'BARBER_DAY_OFF';
}

function sortCandidates(rows: PublicCandidateBarber[]): PublicCandidateBarber[] {
  return [...rows].sort((a, b) =>
    comparePublicBarbers(
      {
        displaySortOrder: a.displaySortOrder ?? 999,
        isFeatured: false,
        nameAr: a.nameAr,
        empId: a.empId,
      },
      {
        displaySortOrder: b.displaySortOrder ?? 999,
        isFeatured: false,
        nameAr: b.nameAr,
        empId: b.empId,
      },
    ),
  );
}

function absoluteBounds(args: {
  workDate: string;
  time: string;
  dayOffset: 0 | 1;
  durationMinutes: number;
  timezone: string;
}): { startDateTime: string; endDateTime: string; startMs: number; endMs: number } {
  const slotDate = args.dayOffset === 1 ? nextDate(args.workDate) : args.workDate;
  const startMs = salonDateTimeToMs(slotDate, args.time, args.timezone);
  const endMs = startMs + args.durationMinutes * 60_000;
  return {
    startMs,
    endMs,
    startDateTime: new Date(startMs).toISOString(),
    endDateTime: new Date(endMs).toISOString(),
  };
}

/**
 * Normalize + evaluate a public booking selection for one exact interval.
 * Does not reserve. Does not read Phase-4 availability cache.
 */
export async function evaluatePublicBookingSelection(args: {
  branchCode?: string | null;
  date?: string | null;
  time?: string | null;
  dayOffset?: unknown;
  serviceIds?: unknown;
  empId?: unknown;
  mode?: unknown;
  purpose: PublicSelectionPurpose;
  /** Ignored publicly — internal_preview not accepted. */
  previewQueryParam?: string | null;
  /** Internal smoke access only — public routes must never pass this. */
  auth?: InternalPreviewAuth | null;
}): Promise<PublicSelectionEvaluation> {
  const evaluatedAt = new Date().toISOString();
  const purpose = args.purpose;

  // Reject preview on public booking purpose
  if (args.previewQueryParam != null && String(args.previewQueryParam).trim() !== '') {
    const p = String(args.previewQueryParam).toLowerCase();
    if (p === 'true' || p === '1' || p === 'yes') {
      throw new PublicBookingSelectionError('BRANCH_NOT_PUBLIC');
    }
  }

  if (!args.branchCode || !String(args.branchCode).trim()) {
    throw new PublicBookingSelectionError('BRANCH_REQUIRED');
  }

  const branchPurpose: PublicBookingPurpose =
    purpose === 'internal_preview' ? 'internal_preview' : 'public_booking';
  let branchContext: PublicBookingBranchContext;
  try {
    branchContext = await resolvePublicBookingBranchContext({
      branchCode: args.branchCode,
      purpose: branchPurpose,
      auth: args.auth ?? undefined,
    });
  } catch (err) {
    if (err instanceof PublicBookingBranchContextError) {
      throw new PublicBookingSelectionError(err.code);
    }
    throw err;
  }

  if (
    !branchContext.bookingEnabled ||
    (purpose !== 'internal_preview' && !branchContext.publicBookingEnabled)
  ) {
    throw new PublicBookingSelectionError('BRANCH_BOOKING_DISABLED');
  }

  const workDate = String(args.date ?? '').trim();
  if (!workDate || !isValidDate(workDate)) {
    throw new PublicBookingSelectionError('INVALID_DATE');
  }
  const requestedTime = String(args.time ?? '').trim();
  if (!requestedTime || !isValidTime(requestedTime)) {
    throw new PublicBookingSelectionError('INVALID_TIME');
  }
  const requestedDayOffset = parseDayOffset(args.dayOffset);
  const empId = parseEmpId(args.empId);
  const mode = normalizeMode(args.mode, empId);

  let selected;
  try {
    selected = await resolveSelectedBookingServices({
      branchContext,
      serviceIds: args.serviceIds as string | number[] | null,
    });
  } catch (err) {
    if (err instanceof BookingServiceDurationError) {
      throw new PublicBookingSelectionError(mapDurationError(err));
    }
    throw err;
  }

  const settings = await getPublicSettings(branchContext.branchId);
  const today = getCairoBusinessDate();
  const horizonEnd = addDaysYmd(today, settings.maxBookingDaysAhead);
  if (isOutsideBookingHorizon(workDate, horizonEnd)) {
    throw new PublicBookingSelectionError('BOOKING_HORIZON_EXCEEDED');
  }

  // Ops/admin create must match available-slots: no public min-notice gate.
  const engineSource: 'public' | 'operations' =
    purpose === 'internal_preview' ? 'operations' : 'public';
  const effectiveMinNoticeMinutes =
    purpose === 'internal_preview' ? 0 : settings.minNoticeMinutes || 0;

  const timezone = settings.timezone || branchContext.timezone || 'Africa/Cairo';
  const bounds = absoluteBounds({
    workDate,
    time: requestedTime,
    dayOffset: requestedDayOffset,
    durationMinutes: selected.totalDurationMinutes,
    timezone,
  });

  // Min notice on absolute start (today or any day before notice window)
  const nowMs = Date.now();
  const minNoticeMs = effectiveMinNoticeMinutes * 60_000;
  if (bounds.startMs < nowMs + minNoticeMs) {
    // Still evaluate for richer codes below, but mark — engine also enforces for "today"
    // For past WorkDates outside today, horizon already covers far future; past dates fail here.
  }

  let specificBarber: PublicCandidateBarber | null = null;
  let candidateBarbers: PublicCandidateBarber[] = [];
  let available = false;
  let availabilityCode: PublicBookingErrorCode | null = null;
  let availabilityMessage: string | null = null;
  const safeMetadata: Record<string, unknown> = {
    evaluationMode: 'strong_fresh',
    purpose,
  };

  if (mode === 'specific_barber') {
    if (!empId) throw new PublicBookingSelectionError('BARBER_NOT_FOUND');
    const identity = await loadEmpPublicIdentity(empId);
    if (!identity) throw new PublicBookingSelectionError('BARBER_NOT_FOUND');
    specificBarber = {
      empId,
      nameAr: identity.nameAr,
      nameEn: identity.nameEn,
      imageUrl: identity.imageUrl,
    };

    const dayClass = await classifySpecificBarberDay({
      empId,
      branchCtx: branchContext,
      date: workDate,
      purpose,
    });
    if (dayClass === 'not_available_publicly') {
      available = false;
      availabilityCode = 'SLOT_UNAVAILABLE';
      availabilityMessage = PUBLIC_BOOKING_ERROR_CATALOG.SLOT_UNAVAILABLE.messageAr;
      safeMetadata.publicVisibility = 'not_available_publicly';
    } else if (dayClass) {
      available = false;
      availabilityCode = dayClass;
      availabilityMessage = PUBLIC_BOOKING_ERROR_CATALOG[dayClass].messageAr;
    } else {
      // Fresh exact-interval evaluation (no Phase-4 cache; no full-day slot grid)
      const validation = await validateBookingSlot({
        date: workDate,
        time: requestedTime,
        dayOffset: requestedDayOffset,
        serviceIds: selected.serviceIds,
        mode: 'specific',
        empId,
        source: engineSource,
        branchId: branchContext.branchId,
        durationOverride: selected.totalDurationMinutes,
        skipNextAvailableWhenOk: true,
      });
      if (validation.available && validation.plan) {
        available = true;
        availabilityCode = null;
        availabilityMessage = null;
      } else {
        available = false;
        if (
          requestedDayOffset === 1 &&
          validation.reasonCode === 'outside_working_hours'
        ) {
          availabilityCode = 'INVALID_DAY_OFFSET';
          availabilityMessage = PUBLIC_BOOKING_ERROR_CATALOG.INVALID_DAY_OFFSET.messageAr;
          safeMetadata.expectedDayOffset = 0;
        } else if (
          requestedDayOffset === 0 &&
          validation.reasonCode === 'outside_working_hours'
        ) {
          const alt = await validateBookingSlot({
            date: workDate,
            time: requestedTime,
            dayOffset: 1,
            serviceIds: selected.serviceIds,
            mode: 'specific',
            empId,
            source: engineSource,
            branchId: branchContext.branchId,
            durationOverride: selected.totalDurationMinutes,
            skipNextAvailableWhenOk: true,
          });
          if (alt.available) {
            availabilityCode = 'INVALID_DAY_OFFSET';
            availabilityMessage = PUBLIC_BOOKING_ERROR_CATALOG.INVALID_DAY_OFFSET.messageAr;
            safeMetadata.expectedDayOffset = 1;
          } else {
            availabilityCode = mapEngineReason(validation.reasonCode);
            availabilityMessage = PUBLIC_BOOKING_ERROR_CATALOG[availabilityCode].messageAr;
          }
        } else {
          availabilityCode = mapEngineReason(validation.reasonCode);
          availabilityMessage = PUBLIC_BOOKING_ERROR_CATALOG[availabilityCode].messageAr;
        }
      }
    }
  } else {
    // any_barber — fresh collectAllCandidates; no guaranteed assignment
    const engine = await listAvailableBookingSlots({
      date: workDate,
      serviceIds: selected.serviceIds,
      mode: 'nearest',
      empId: null,
      branchId: branchContext.branchId,
      source: engineSource,
      durationOverride: selected.totalDurationMinutes,
      collectAllCandidates: true,
    });

    const eligibleCount = Number(engine.debug.barberCount ?? 0);
    if (eligibleCount === 0) {
      throw new PublicBookingSelectionError('NO_ELIGIBLE_BARBER');
    }

    const matches = engine.availableSlots.filter(
      (s) => s.available && s.time === requestedTime && s.dayOffset === requestedDayOffset,
    );
    const byEmp = new Map<number, PublicCandidateBarber>();
    for (const m of matches) {
      if (!byEmp.has(m.empId)) {
        byEmp.set(m.empId, {
          empId: m.empId,
          nameAr: m.empName,
          nameEn: getBarberNameEnByArabicName(m.empName),
          imageUrl: resolveBarberPublicImageUrl(null, m.empName),
        });
      }
    }
    const sortOrders = await loadEmpDisplaySortOrders([...byEmp.keys()]);
    for (const [empId, row] of byEmp) {
      byEmp.set(empId, {
        ...row,
        displaySortOrder: sortOrders.get(empId) ?? 999,
      });
    }
    candidateBarbers = sortCandidates([...byEmp.values()]);

    if (candidateBarbers.length > 0) {
      available = true;
    } else {
      available = false;
      const validation = await validateBookingSlot({
        date: workDate,
        time: requestedTime,
        dayOffset: requestedDayOffset,
        serviceIds: selected.serviceIds,
        mode: 'nearest',
        source: engineSource,
        branchId: branchContext.branchId,
        durationOverride: selected.totalDurationMinutes,
        skipNextAvailableWhenOk: true,
      });
      if (
        requestedDayOffset === 1 &&
        validation.reasonCode === 'outside_working_hours'
      ) {
        availabilityCode = 'INVALID_DAY_OFFSET';
        availabilityMessage = PUBLIC_BOOKING_ERROR_CATALOG.INVALID_DAY_OFFSET.messageAr;
        safeMetadata.expectedDayOffset = 0;
      } else {
        const overnightAlt = engine.availableSlots.some(
          (s) => s.available && s.time === requestedTime && s.dayOffset === 1,
        );
        if (requestedDayOffset === 0 && overnightAlt) {
          availabilityCode = 'INVALID_DAY_OFFSET';
          availabilityMessage = PUBLIC_BOOKING_ERROR_CATALOG.INVALID_DAY_OFFSET.messageAr;
          safeMetadata.expectedDayOffset = 1;
        } else {
          availabilityCode = mapEngineReason(validation.reasonCode);
          availabilityMessage = PUBLIC_BOOKING_ERROR_CATALOG[availabilityCode].messageAr;
        }
      }
    }
  }

  // Absolute min-notice override when start is too soon (public only;
  // internal ops/admin already waive min notice like available-slots).
  if (available && minNoticeMs > 0 && bounds.startMs < nowMs + minNoticeMs) {
    available = false;
    availabilityCode = 'MIN_NOTICE_NOT_MET';
    availabilityMessage = PUBLIC_BOOKING_ERROR_CATALOG.MIN_NOTICE_NOT_MET.messageAr;
    candidateBarbers = [];
  }

  const assignmentStrategy: AssignmentStrategy =
    mode === 'specific_barber' ? 'fixed_barber' : 'server_select_on_create';

  let planFingerprint: string | null = null;
  let planToken: string | null = null;
  let planExpiresAt: string | null = null;
  if (available) {
    const minted = mintPlanFingerprint(
      {
        contractVersion: BOOKING_PLAN_CONTRACT_VERSION,
        branchCode: branchContext.branchCode,
        serviceIds: selected.serviceIds,
        mode,
        empId: mode === 'specific_barber' ? empId : null,
        workDate,
        time: requestedTime,
        dayOffset: requestedDayOffset,
        totalDurationMinutes: selected.totalDurationMinutes,
        subtotal: selected.totalPrice,
      },
      evaluatedAt,
    );
    planFingerprint = minted.planFingerprint;
    planToken = minted.planToken;
    planExpiresAt = minted.expiresAt;
  }

  return {
    branchContext,
    mode,
    assignmentStrategy,
    workDate,
    requestedTime,
    requestedDayOffset,
    startDateTime: available || bounds.startMs ? bounds.startDateTime : null,
    endDateTime: available || bounds.startMs ? bounds.endDateTime : null,
    selectedServices: selected.services,
    totalDurationMinutes: selected.totalDurationMinutes,
    subtotal: selected.totalPrice,
    pricingScope: 'global',
    specificBarber,
    candidateBarbers,
    available,
    availabilityCode,
    availabilityMessage,
    safeMetadata,
    evaluatedAt,
    purpose,
    planFingerprint,
    planToken,
    planExpiresAt,
    contractVersion: BOOKING_PLAN_CONTRACT_VERSION,
    evaluationMode: 'strong_fresh',
  };
}

/** Parity helper — verifier-facing; throws PLAN_CHECK_SLOT_MISMATCH on drift. */
export function assertCheckSlotPlanParity(
  check: PublicSelectionEvaluation,
  plan: PublicSelectionEvaluation,
): void {
  const keys: Array<keyof PublicSelectionEvaluation> = [
    'available',
    'mode',
    'workDate',
    'requestedTime',
    'requestedDayOffset',
    'totalDurationMinutes',
    'subtotal',
    'availabilityCode',
  ];
  for (const k of keys) {
    if (check[k] !== plan[k]) {
      throw new PublicBookingSelectionError('PLAN_CHECK_SLOT_MISMATCH', {
        field: k,
        check: check[k],
        plan: plan[k],
      });
    }
  }
  if (check.branchContext.branchCode !== plan.branchContext.branchCode) {
    throw new PublicBookingSelectionError('PLAN_CHECK_SLOT_MISMATCH', { field: 'branchCode' });
  }
  const checkIds = check.selectedServices.map((s) => s.serviceId).join(',');
  const planIds = plan.selectedServices.map((s) => s.serviceId).join(',');
  if (checkIds !== planIds) {
    throw new PublicBookingSelectionError('PLAN_CHECK_SLOT_MISMATCH', { field: 'serviceIds' });
  }
  if (check.mode === 'specific_barber') {
    if (check.specificBarber?.empId !== plan.specificBarber?.empId) {
      throw new PublicBookingSelectionError('PLAN_CHECK_SLOT_MISMATCH', { field: 'empId' });
    }
  } else {
    const a = check.candidateBarbers.map((b) => b.empId).sort((x, y) => x - y).join(',');
    const b = plan.candidateBarbers.map((c) => c.empId).sort((x, y) => x - y).join(',');
    if (a !== b) {
      throw new PublicBookingSelectionError('PLAN_CHECK_SLOT_MISMATCH', { field: 'candidates' });
    }
  }
  if (check.available && plan.available) {
    if (check.startDateTime !== plan.startDateTime || check.endDateTime !== plan.endDateTime) {
      throw new PublicBookingSelectionError('PLAN_CHECK_SLOT_MISMATCH', { field: 'interval' });
    }
  }
  if (!check.available && plan.available) {
    throw new PublicBookingSelectionError('PLAN_CHECK_SLOT_MISMATCH', {
      field: 'available',
      note: 'plan must not succeed when check-slot unavailable',
    });
  }
}
