/**
 * Booking Phase 6 — transactional public booking create.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  PublicBookingSelectionError,
  evaluatePublicBookingSelection,
  type PublicSelectionEvaluation,
  type PublicSelectionMode,
} from '@/lib/booking/publicBookingSelectionEvaluator';
import {
  BOOKING_PLAN_CONTRACT_VERSION,
  buildPlanContentDigest,
  verifyPlanToken,
} from '@/lib/booking/publicBookingPlanFingerprint';
import { resolveBarberPublicImageUrl } from '@/lib/booking/publicBookingBarberPolicy';
import { getBarberNameEnByArabicName } from '@/lib/barberImages';
import {
  PUBLIC_BOOKING_ERROR_CATALOG,
  type PublicBookingErrorCode,
} from '@/lib/booking/publicBookingErrorCatalog';
import {
  buildContractCompatibilityMetadata,
  isPublicBookingEnforceMode,
  logLegacyContractUsed,
  type ContractCompatibilityFlags,
} from '@/lib/booking/publicBookingContractMode';
import {
  acquireBookingAppLock,
  anyBarberAssignmentLockResource,
  empIntervalLockResource,
  hashServiceSet,
  BookingCreateLockError,
} from '@/lib/booking/publicBookingCreateLocks';
import {
  buildCreateRequestFingerprint,
  claimIdempotencyKeyAutonomous,
  completeIdempotencySuccess,
  ensurePublicBookingCreateIdempotencyTable,
  markIdempotencyFailed,
  markIdempotencyNotificationSent,
  IdempotencyConflictError,
} from '@/lib/booking/publicBookingCreateIdempotency';
import {
  assertEmployeeIntervalAvailable,
  ScheduleConflictError,
} from '@/lib/scheduleIntegrity';
import {
  generateBookingCode,
  getGlobalTimingDefaults,
  isUsableCustomerPhone,
  isValidDate,
  isValidPhone,
  isValidTime,
  normalizePublicBookingPhone,
  upsertCustomer,
} from '@/lib/publicBookingHelpers';
import { scheduleBookingWhatsAppAfterCommit } from '@/lib/bookingPostCommitNotification';
import { invalidatePublicBookingAvailabilityCache } from '@/lib/booking/publicBookingAvailability';
import { ensureBookingPublicWorkDateColumns } from '@/lib/booking/ensureBookingPublicWorkDateColumns';

const MAX_NOTES = 500;
const MAX_SERVICES = 20;
const MAX_NAME = 80;
const CODE_ATTEMPTS = 5;

/**
 * Verifier-only test hooks.  These can only be armed by an exported setter that
 * requires BOOKING_PHASE_6C_VERIFIER=enabled, so public production requests can
 * never activate them.
 */
type BookingCreateTestHooks = {
  generateBookingCode?: () => string;
  postBookingHeadInsert?: (args: {
    bookingId: number;
    transaction: sql.Transaction;
    idempotencyRequestId: number | null;
  }) => Promise<void> | void;
};

let activeTestHooks: BookingCreateTestHooks | null = null;

export function setBookingCreateTestHooks(hooks: BookingCreateTestHooks): void {
  if (process.env.BOOKING_PHASE_6C_VERIFIER !== 'enabled') {
    throw new Error('BOOKING_PHASE_6C_VERIFIER is required to arm test hooks');
  }
  activeTestHooks = hooks;
}

export function clearBookingCreateTestHooks(): void {
  activeTestHooks = null;
}

function generateBookingCodeWithInjection(): string {
  if (activeTestHooks?.generateBookingCode) {
    return activeTestHooks.generateBookingCode();
  }
  return generateBookingCode();
}

async function runPostBookingHeadInsertHook(args: {
  bookingId: number;
  transaction: sql.Transaction;
  idempotencyRequestId: number | null;
}): Promise<void> {
  if (activeTestHooks?.postBookingHeadInsert) {
    await activeTestHooks.postBookingHeadInsert(args);
  }
}

export class PublicBookingCreateError extends Error {
  readonly code: PublicBookingErrorCode;
  readonly metadata: Record<string, unknown>;
  constructor(code: PublicBookingErrorCode, metadata: Record<string, unknown> = {}) {
    super(code);
    this.name = 'PublicBookingCreateError';
    this.code = code;
    this.metadata = metadata;
  }
}

export type PlanTokenStatus = 'valid' | 'absent_legacy' | 'expired_revalidated';

export type PublicBookingCreateInput = {
  branchCode?: string | null;
  date?: string | null;
  time?: string | null;
  dayOffset?: unknown;
  serviceIds?: unknown;
  empId?: unknown;
  mode?: unknown;
  planToken?: string | null;
  customer?: { name?: string; phone?: string | null } | null;
  notes?: string | null;
  clientRequestId?: string | null;
  idempotencyKeyHeader?: string | null;
  previewQueryParam?: string | null;
  /** When set, skip WhatsApp (smoke). */
  suppressNotification?: boolean;
  /** Verifier-only internal preview auth. Public routes must never pass this. */
  auth?: { userId: number; canOperate?: boolean } | null;
  /** Verifier-only purpose override. Defaults to public_booking. */
  purpose?: 'public_booking' | 'internal_preview';
};

export type PublicBookingCreateResult = {
  httpStatus: 201;
  body: {
    ok: true;
    booking: Record<string, unknown>;
    meta: {
      idempotentReplay: boolean;
      planTokenStatus: PlanTokenStatus;
      createdAt: string;
      assignmentStrategy: string;
    };
    message: string;
    whatsapp?: { scheduled: boolean; skipped: boolean; reason: string };
    compatibility?: ContractCompatibilityFlags;
  };
};

function nextDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatCairoHhmm(epochMs: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(epochMs));
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h}:${m}`;
  } catch {
    const d = new Date(epochMs);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
}

function normalizeMode(raw: unknown, empId: number | null): PublicSelectionMode {
  const m = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (m === 'any_barber' || m === 'nearest') return 'any_barber';
  if (m === 'specific_barber' || m === 'specific') {
    if (!empId) throw new PublicBookingCreateError('BARBER_NOT_FOUND');
    return 'specific_barber';
  }
  return empId ? 'specific_barber' : 'any_barber';
}

function parseOptionalEmpId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new PublicBookingCreateError('BARBER_NOT_FOUND');
  return n;
}

function validatePlanTokenAgainstRequest(
  token: string,
  args: {
    branchCode: string;
    workDate: string;
    time: string;
    dayOffset: 0 | 1;
    serviceIds: number[];
    mode: PublicSelectionMode;
    empId: number | null;
    totalDurationMinutes: number;
    subtotal: number;
  },
): PlanTokenStatus {
  const verified = verifyPlanToken(token);
  if (!verified.ok) {
    if (verified.reason === 'expired') {
      throw new PublicBookingCreateError('PLAN_TOKEN_EXPIRED');
    }
    throw new PublicBookingCreateError('PLAN_TOKEN_INVALID');
  }
  const p = verified.payload;
  const expectedFp = buildPlanContentDigest({
    contractVersion: BOOKING_PLAN_CONTRACT_VERSION,
    branchCode: args.branchCode,
    serviceIds: args.serviceIds,
    mode: args.mode,
    empId: args.mode === 'specific_barber' ? args.empId : null,
    workDate: args.workDate,
    time: args.time,
    dayOffset: args.dayOffset,
    totalDurationMinutes: args.totalDurationMinutes,
    subtotal: args.subtotal,
  });
  const same =
    String(p.contractVersion) === BOOKING_PLAN_CONTRACT_VERSION &&
    String(p.branchCode) === args.branchCode &&
    String(p.workDate) === args.workDate &&
    String(p.time) === args.time &&
    Number(p.dayOffset) === args.dayOffset &&
    String(p.mode) === args.mode &&
    Number(p.totalDurationMinutes) === args.totalDurationMinutes &&
    Number(p.subtotal) === args.subtotal &&
    String(p.fingerprint) === expectedFp &&
    JSON.stringify(p.serviceIds) === JSON.stringify(args.serviceIds) &&
    (args.mode === 'specific_barber'
      ? Number(p.empId) === args.empId
      : p.empId == null || p.empId === null);

  if (!same) {
    throw new PublicBookingCreateError('PLAN_TOKEN_REQUEST_MISMATCH');
  }
  return 'valid';
}

function buildPublicResponse(args: {
  evaluation: PublicSelectionEvaluation;
  bookingCode: string;
  selectedEmpId: number;
  selectedNameAr: string;
  assignmentStrategy: string;
  calendarDate: string;
  endTimeHhmm: string;
  idempotentReplay: boolean;
  planTokenStatus: PlanTokenStatus;
  createdAt: string;
  bookingAccessToken?: string;
  compatibility?: ContractCompatibilityFlags | null;
}): PublicBookingCreateResult['body'] {
  const e = args.evaluation;
  const branch = e.branchContext;
  return {
    ok: true,
    booking: {
      code: args.bookingCode,
      status: 'confirmed',
      branch: {
        branchCode: branch.branchCode,
        branchName: branch.branchName,
        address: branch.address,
        phone: branch.phone,
      },
      barber: {
        empId: args.selectedEmpId,
        nameAr: args.selectedNameAr,
        nameEn:
          args.evaluation.specificBarber?.nameEn ??
          getBarberNameEnByArabicName(args.selectedNameAr),
        imageUrl:
          args.evaluation.specificBarber?.imageUrl ??
          resolveBarberPublicImageUrl(null, args.selectedNameAr),
      },
      assignmentStrategy: args.assignmentStrategy,
      date: e.workDate,
      calendarDate: args.calendarDate,
      time: e.requestedTime,
      dayOffset: e.requestedDayOffset,
      startDateTime: e.startDateTime,
      endDateTime: e.endDateTime,
      endTime: args.endTimeHhmm,
      services: e.selectedServices.map((s) => ({
        serviceId: s.serviceId,
        nameAr: s.nameAr,
        nameEn: s.nameEn,
        price: s.price,
        durationMinutes: s.durationMinutes,
      })),
      totalDurationMinutes: e.totalDurationMinutes,
      subtotal: e.subtotal,
      discount: 0,
      total: e.subtotal,
      currency: 'EGP',
      pricingScope: e.pricingScope,
      ...(args.bookingAccessToken
        ? { bookingAccessToken: args.bookingAccessToken }
        : {}),
    },
    meta: {
      idempotentReplay: args.idempotentReplay,
      planTokenStatus: args.planTokenStatus,
      createdAt: args.createdAt,
      assignmentStrategy: args.assignmentStrategy,
    },
    ...(args.compatibility ? { compatibility: args.compatibility } : {}),
    message: 'تم تأكيد الحجز بنجاح',
  };
}

/**
 * Create a public booking under SERIALIZABLE + applocks.
 * Notifications run only after commit; never inside the SQL transaction.
 */
export async function createPublicBooking(
  input: PublicBookingCreateInput,
): Promise<PublicBookingCreateResult> {
  const customerName = String(input.customer?.name ?? '').trim();
  if (customerName.length < 2 || customerName.length > MAX_NAME) {
    throw new PublicBookingCreateError('INVALID_CUSTOMER');
  }
  const rawPhone = String(input.customer?.phone ?? '');
  const customerPhone = normalizePublicBookingPhone(rawPhone);
  if (!customerPhone || !isValidPhone(customerPhone)) {
    throw new PublicBookingCreateError('INVALID_CUSTOMER');
  }

  const notes = (input.notes ?? '').toString().trim();
  if (notes.length > MAX_NOTES) {
    throw new PublicBookingCreateError('INVALID_NOTES');
  }

  let empIdRaw = parseOptionalEmpId(input.empId);
  const modeHint = normalizeMode(input.mode, empIdRaw);
  // Policy: any_barber ignores client empId (server selects under lock).
  if (modeHint === 'any_barber') empIdRaw = null;

  const idempotencyKey = (
    input.clientRequestId?.trim() ||
    input.idempotencyKeyHeader?.trim() ||
    ''
  ).slice(0, 128);

  const hasPlanTokenEarly = !!(input.planToken && String(input.planToken).trim());
  const hasIdempotencyEarly = !!idempotencyKey;
  if (isPublicBookingEnforceMode()) {
    if (!hasPlanTokenEarly) {
      throw new PublicBookingCreateError('PLAN_TOKEN_REQUIRED');
    }
    if (!hasIdempotencyEarly) {
      throw new PublicBookingCreateError('IDEMPOTENCY_KEY_REQUIRED');
    }
  } else if (!hasPlanTokenEarly || !hasIdempotencyEarly) {
    logLegacyContractUsed({
      routeFamily: 'create',
      missingRequirement:
        !hasPlanTokenEarly && !hasIdempotencyEarly
          ? 'both'
          : !hasPlanTokenEarly
            ? 'planToken'
            : 'idempotencyKey',
    });
  }
  const createCompatibility = buildContractCompatibilityMetadata({
    missingPlanToken: !hasPlanTokenEarly,
    missingIdempotencyKey: !hasIdempotencyEarly,
  });

  // Normalize selection fields for fingerprint before availability (idempotent replay).
  const { parsePublicServiceIdsParam } = await import(
    '@/lib/booking/publicBookingBarberPolicy'
  );
  const workDateEarly = String(input.date ?? '').trim();
  const timeEarly = String(input.time ?? '').trim();
  if (!workDateEarly || !isValidDate(workDateEarly)) {
    throw new PublicBookingCreateError('INVALID_DATE');
  }
  if (!timeEarly || !isValidTime(timeEarly)) {
    throw new PublicBookingCreateError('INVALID_TIME');
  }
  const dayOffsetEarly =
    input.dayOffset === 0 || input.dayOffset === '0'
      ? 0
      : input.dayOffset === 1 || input.dayOffset === '1'
        ? 1
        : null;
  if (dayOffsetEarly == null) {
    throw new PublicBookingCreateError('INVALID_DAY_OFFSET');
  }
  const parsedServices =
    typeof input.serviceIds === 'string'
      ? parsePublicServiceIdsParam(input.serviceIds)
      : parsePublicServiceIdsParam(
          (Array.isArray(input.serviceIds) ? input.serviceIds : [])
            .map(String)
            .join(','),
        );
  if (!parsedServices.ok || parsedServices.ids.length === 0) {
    throw new PublicBookingCreateError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
  }
  if (!input.branchCode || !String(input.branchCode).trim()) {
    throw new PublicBookingCreateError('BRANCH_REQUIRED');
  }
  const branchCodeEarly = String(input.branchCode).trim().toUpperCase();

  const requestFingerprint = buildCreateRequestFingerprint({
    contractVersion: BOOKING_PLAN_CONTRACT_VERSION,
    branchCode: branchCodeEarly,
    workDate: workDateEarly,
    time: timeEarly,
    dayOffset: dayOffsetEarly,
    serviceIds: parsedServices.ids,
    mode: modeHint,
    empId: modeHint === 'specific_barber' ? empIdRaw : null,
    customerPhone,
  });

  // Early idempotency — before availability precheck
  if (idempotencyKey) {
    await ensurePublicBookingCreateIdempotencyTable();
    const dbEarly = await getPool();
    const existing = await dbEarly
      .request()
      .input('key', sql.NVarChar(128), idempotencyKey)
      .query(`
        SELECT TOP 1
          RequestFingerprint, Status, ResponseJson,
          CAST(NotificationSent AS BIT) AS NotificationSent
        FROM dbo.TblPublicBookingCreateRequest
        WHERE IdempotencyKey = @key
      `);
    const row = existing.recordset[0] as
      | {
          RequestFingerprint: string;
          Status: string;
          ResponseJson: string | null;
          NotificationSent: boolean;
        }
      | undefined;

    if (row) {
      if (row.RequestFingerprint !== requestFingerprint) {
        throw new PublicBookingCreateError('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
      }
      if (row.Status === 'COMPLETED' && row.ResponseJson) {
        const body = JSON.parse(row.ResponseJson) as PublicBookingCreateResult['body'];
        body.meta = {
          ...body.meta,
          idempotentReplay: true,
          planTokenStatus: input.planToken ? 'valid' : 'absent_legacy',
          createdAt: body.meta?.createdAt ?? new Date().toISOString(),
          assignmentStrategy: String(
            body.meta?.assignmentStrategy ?? body.booking?.assignmentStrategy ?? '',
          ),
        };
        return {
          httpStatus: 201,
          body: {
            ...body,
            ...(createCompatibility ? { compatibility: createCompatibility } : {}),
            whatsapp: {
              scheduled: false,
              skipped: true,
              reason: row.NotificationSent
                ? 'idempotent_replay'
                : 'idempotent_replay_no_prior_notify',
            },
          },
        };
      }
      if (row.Status === 'PENDING') {
        throw new PublicBookingCreateError('IDEMPOTENCY_REQUEST_IN_PROGRESS');
      }
      // FAILED → continue and reclaim in TX
    }
  }

  const evalPurpose =
    input.purpose === 'internal_preview' && input.auth?.userId
      ? 'internal_preview'
      : 'create_precheck';
  let precheck: PublicSelectionEvaluation;
  try {
    precheck = await evaluatePublicBookingSelection({
      branchCode: input.branchCode,
      date: input.date,
      time: input.time,
      dayOffset: input.dayOffset,
      serviceIds: input.serviceIds,
      empId: empIdRaw,
      mode: modeHint,
      purpose: evalPurpose,
      previewQueryParam: input.previewQueryParam,
      auth: input.auth,
    });
  } catch (err) {
    if (err instanceof PublicBookingSelectionError) {
      throw new PublicBookingCreateError(err.code, err.metadata);
    }
    throw err;
  }

  if (!precheck.available) {
    const code = (precheck.availabilityCode ?? 'SLOT_UNAVAILABLE') as PublicBookingErrorCode;
    throw new PublicBookingCreateError(code, precheck.safeMetadata);
  }

  if (precheck.selectedServices.length > MAX_SERVICES) {
    throw new PublicBookingCreateError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
  }

  let planTokenStatus: PlanTokenStatus = 'absent_legacy';
  if (input.planToken && String(input.planToken).trim()) {
    planTokenStatus = validatePlanTokenAgainstRequest(String(input.planToken).trim(), {
      branchCode: precheck.branchContext.branchCode,
      workDate: precheck.workDate,
      time: precheck.requestedTime,
      dayOffset: precheck.requestedDayOffset,
      serviceIds: precheck.selectedServices.map((s) => s.serviceId),
      mode: precheck.mode,
      empId: precheck.specificBarber?.empId ?? null,
      totalDurationMinutes: precheck.totalDurationMinutes,
      subtotal: precheck.subtotal,
    });
  }

  await ensurePublicBookingCreateIdempotencyTable();
  await ensureBookingPublicWorkDateColumns();

  // Preload timing defaults before TX (avoid mid-TX pool chatter on cache miss)
  await getGlobalTimingDefaults();

  // Refresh branch + services before opening write TX (not final busy guarantee)
  const { resolveSelectedBookingServices } = await import(
    '@/lib/booking/bookingServiceDuration'
  );
  const { resolvePublicBookingBranchContext } = await import(
    '@/lib/booking/publicBookingBranchContext'
  );
  const createPurpose = input.purpose === 'internal_preview' ? 'internal_preview' : 'public_booking';
  const branchNow = await resolvePublicBookingBranchContext({
    branchCode: precheck.branchContext.branchCode,
    purpose: createPurpose,
    auth: input.auth,
  });
  if (
    !branchNow.bookingEnabled ||
    (createPurpose === 'public_booking' && !branchNow.publicBookingEnabled)
  ) {
    throw new PublicBookingCreateError('BRANCH_BOOKING_DISABLED');
  }
  const servicesNow = await resolveSelectedBookingServices({
    branchContext: branchNow,
    serviceIds: precheck.selectedServices.map((s) => s.serviceId),
  });
  if (
    servicesNow.totalDurationMinutes !== precheck.totalDurationMinutes ||
    servicesNow.totalPrice !== precheck.subtotal
  ) {
    throw new PublicBookingCreateError('SLOT_UNAVAILABLE');
  }

  const startMs = new Date(precheck.startDateTime!).getTime();
  const endMs = new Date(precheck.endDateTime!).getTime();
  const calendarDate =
    precheck.requestedDayOffset === 1 ? nextDate(precheck.workDate) : precheck.workDate;
  const timezone = branchNow.timezone || 'Africa/Cairo';
  const endTimeHhmm = formatCairoHhmm(endMs, timezone);
  const startTimeStr = `${precheck.requestedTime}:00`;
  const endTimeStr = `${endTimeHhmm}:00`;

  let idempotencyRequestId: number | null = null;
  let notificationAlreadySent = false;

  // Claim outside the booking TX so PENDING survives rollback and markFailed can persist.
  if (idempotencyKey) {
    try {
      const claim = await claimIdempotencyKeyAutonomous({
        idempotencyKey,
        requestFingerprint,
      });
      if (claim.kind === 'replay') {
        notificationAlreadySent = !!claim.row.NotificationSent;
        const body = JSON.parse(claim.row.ResponseJson!) as PublicBookingCreateResult['body'];
        body.meta = {
          ...body.meta,
          idempotentReplay: true,
          planTokenStatus,
          createdAt: body.meta?.createdAt ?? new Date().toISOString(),
          assignmentStrategy: String(
            body.meta?.assignmentStrategy ?? body.booking?.assignmentStrategy ?? '',
          ),
        };
        return {
          httpStatus: 201,
          body: {
            ...body,
            ...(createCompatibility ? { compatibility: createCompatibility } : {}),
            whatsapp: {
              scheduled: false,
              skipped: true,
              reason: notificationAlreadySent
                ? 'idempotent_replay'
                : 'idempotent_replay_no_prior_notify',
            },
          },
        };
      }
      idempotencyRequestId = claim.requestId;
    } catch (err) {
      if (err instanceof IdempotencyConflictError) {
        throw new PublicBookingCreateError(err.code);
      }
      throw err;
    }
  }

  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // Hold the claimed idempotency row for the duration of the write TX.
    if (idempotencyRequestId != null) {
      await new sql.Request(transaction)
        .input('id', sql.BigInt, idempotencyRequestId)
        .query(`
          SELECT RequestID
          FROM dbo.TblPublicBookingCreateRequest WITH (UPDLOCK, HOLDLOCK)
          WHERE RequestID = @id AND Status = N'PENDING'
        `);
    }

    let selectedEmpId: number;
    let selectedNameAr: string;
    let assignmentStrategy: string;

    if (precheck.mode === 'specific_barber') {
      selectedEmpId = precheck.specificBarber!.empId;
      selectedNameAr = precheck.specificBarber!.nameAr;
      assignmentStrategy = 'fixed_barber';
      await acquireBookingAppLock(
        transaction,
        empIntervalLockResource(selectedEmpId, startMs, endMs),
      );
      await assertEmployeeIntervalAvailable({
        empId: selectedEmpId,
        startAt: new Date(startMs),
        endAt: new Date(endMs),
        operationalDate: precheck.workDate,
        transaction,
      });
    } else {
      assignmentStrategy = 'server_selected';
      const svcHash = hashServiceSet(precheck.selectedServices.map((s) => s.serviceId));
      await acquireBookingAppLock(
        transaction,
        anyBarberAssignmentLockResource(branchNow.branchId, startMs, endMs, svcHash),
      );

      const candidates = [...precheck.candidateBarbers].sort((a, b) => a.empId - b.empId);
      if (!candidates.length) {
        throw new PublicBookingCreateError('NO_ELIGIBLE_BARBER');
      }

      let chosen: { empId: number; nameAr: string } | null = null;
      for (const c of candidates) {
        try {
          await acquireBookingAppLock(
            transaction,
            empIntervalLockResource(c.empId, startMs, endMs),
          );
          await assertEmployeeIntervalAvailable({
            empId: c.empId,
            startAt: new Date(startMs),
            endAt: new Date(endMs),
            operationalDate: precheck.workDate,
            transaction,
          });
          chosen = c;
          break;
        } catch (err) {
          if (err instanceof BookingCreateLockError) continue;
          if (err instanceof ScheduleConflictError) continue;
          throw err;
        }
      }
      if (!chosen) {
        throw new PublicBookingCreateError('SLOT_UNAVAILABLE');
      }
      selectedEmpId = chosen.empId;
      selectedNameAr = chosen.nameAr;
    }

    const clientId = await upsertCustomer(customerName, customerPhone, transaction);

    const notesPersist = [
      notes,
      `[p6] workDate=${precheck.workDate};dayOffset=${precheck.requestedDayOffset}`,
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, MAX_NOTES);

    let bookingCode = generateBookingCodeWithInjection();
    let bookingId: number | null = null;
    const planFp =
      precheck.planFingerprint ??
      (input.planToken ? String(input.planToken).slice(0, 128) : null);
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      try {
        const ins = await new sql.Request(transaction)
          .input('clientId', sql.Int, clientId)
          .input('empId', sql.Int, selectedEmpId)
          .input('bDate', sql.Date, calendarDate)
          .input('sTime', sql.VarChar, startTimeStr)
          .input('eTime', sql.VarChar, endTimeStr)
          .input('source', sql.NVarChar, 'online')
          .input('notes', sql.NVarChar, notesPersist || null)
          .input('code', sql.NVarChar, bookingCode)
          .input('branchId', sql.Int, branchNow.branchId)
          .input('workDate', sql.Date, precheck.workDate)
          .input('dayOffset', sql.TinyInt, precheck.requestedDayOffset)
          .input('absStart', sql.DateTime2, new Date(startMs))
          .input('absEnd', sql.DateTime2, new Date(endMs))
          .input('planFp', sql.NVarChar(128), planFp)
          .input('idemReqId', sql.BigInt, idempotencyRequestId)
          .query(`
            INSERT INTO [dbo].[Bookings]
              (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
               Status, Source, Notes, BookingCode, CreatedByUserID, BranchID,
               PublicWorkDate, PublicDayOffset, AbsoluteStartUtc, AbsoluteEndUtc,
               PlanFingerprint, IdempotencyRequestID)
            OUTPUT INSERTED.BookingID
            VALUES
              (@clientId, @empId, @bDate, @sTime, @eTime,
               'confirmed', @source, @notes, @code, 0, @branchId,
               @workDate, @dayOffset, @absStart, @absEnd,
               @planFp, @idemReqId)
          `);
        bookingId = Number(ins.recordset[0].BookingID);
        await runPostBookingHeadInsertHook({
          bookingId,
          transaction,
          idempotencyRequestId,
        });
        break;
      } catch (codeErr: unknown) {
        const msg = String((codeErr as { message?: string })?.message ?? '');
        const num = (codeErr as { number?: number })?.number;
        const isDup =
          msg.includes('BookingCode') ||
          msg.includes('UNIQUE') ||
          msg.includes('duplicate') ||
          num === 2627 ||
          num === 2601;
        if (!isDup || attempt === CODE_ATTEMPTS - 1) {
          if (isDup) throw new PublicBookingCreateError('BOOKING_CODE_GENERATION_FAILED');
          throw codeErr;
        }
        bookingCode = generateBookingCodeWithInjection();
      }
    }
    if (bookingId == null) {
      throw new PublicBookingCreateError('BOOKING_CREATE_FAILED');
    }

    for (const line of servicesNow.services) {
      await new sql.Request(transaction)
        .input('bId', sql.Int, bookingId)
        .input('proId', sql.Int, line.serviceId)
        .input('eId', sql.Int, selectedEmpId)
        .input('qty', sql.Decimal(18, 2), 1)
        .input('price', sql.Decimal(18, 2), line.price)
        .input('mins', sql.Int, line.durationMinutes)
        .query(`
          INSERT INTO [dbo].[BookingServices]
            (BookingID, ProID, EmpID, Qty, Price, DurationMinutes)
          VALUES (@bId, @proId, @eId, @qty, @price, @mins)
        `);
    }

    const createdAt = new Date().toISOString();
    const { mintBookingAccessToken } = await import('@/lib/booking/publicBookingAccessToken');
    const { token: bookingAccessToken } = mintBookingAccessToken({
      bookingCode,
      normalizedPhone: customerPhone,
    });
    const body = buildPublicResponse({
      evaluation: {
        ...precheck,
        selectedServices: servicesNow.services,
        totalDurationMinutes: servicesNow.totalDurationMinutes,
        subtotal: servicesNow.totalPrice,
        branchContext: {
          ...precheck.branchContext,
          ...branchNow,
        },
      },
      bookingCode,
      selectedEmpId,
      selectedNameAr,
      assignmentStrategy,
      calendarDate,
      endTimeHhmm,
      idempotentReplay: false,
      planTokenStatus,
      createdAt,
      bookingAccessToken,
      compatibility: createCompatibility,
    });

    if (idempotencyRequestId != null) {
      await completeIdempotencySuccess(transaction, {
        requestId: idempotencyRequestId,
        bookingId,
        bookingCode,
        responseJson: JSON.stringify(body),
      });
    }

    await transaction.commit();

    invalidatePublicBookingAvailabilityCache();
    try {
      const { invalidatePublicBookingBarberRelatedCaches } = await import(
        '@/lib/booking/publicBookingBarbers'
      );
      invalidatePublicBookingBarberRelatedCaches();
    } catch {
      /* optional */
    }

    let whatsapp: PublicBookingCreateResult['body']['whatsapp'] = {
      scheduled: false,
      skipped: true,
      reason: 'none',
    };

    const shouldNotify =
      !input.suppressNotification &&
      !notificationAlreadySent &&
      isUsableCustomerPhone(customerPhone);

    if (shouldNotify) {
      scheduleBookingWhatsAppAfterCommit({
        phone: customerPhone,
        customerName,
        bookingId,
        bookingDate: calendarDate,
        bookingTime: precheck.requestedTime,
        barberName: selectedNameAr,
        services: servicesNow.services.map((s) => s.nameAr),
        branchName: branchNow.branchName,
      });
      whatsapp = { scheduled: true, skipped: false, reason: 'post_commit' };
      if (idempotencyRequestId != null) {
        await markIdempotencyNotificationSent(idempotencyRequestId).catch(() => undefined);
      }
    } else if (!isUsableCustomerPhone(customerPhone)) {
      whatsapp = { scheduled: false, skipped: true, reason: 'placeholder_or_invalid_phone' };
    } else if (input.suppressNotification) {
      whatsapp = { scheduled: false, skipped: true, reason: 'suppressed' };
    }

    return {
      httpStatus: 201,
      body: { ...body, whatsapp },
    };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    if (err instanceof IdempotencyConflictError) {
      throw new PublicBookingCreateError(err.code);
    }
    if (err instanceof BookingCreateLockError) {
      await markIdempotencyFailed(idempotencyRequestId, err.code);
      throw new PublicBookingCreateError(err.code);
    }
    if (err instanceof ScheduleConflictError) {
      await markIdempotencyFailed(idempotencyRequestId, 'SLOT_UNAVAILABLE');
      throw new PublicBookingCreateError('SLOT_UNAVAILABLE');
    }
    if (err instanceof PublicBookingSelectionError) {
      await markIdempotencyFailed(idempotencyRequestId, err.code);
      throw new PublicBookingCreateError(err.code, err.metadata);
    }
    if (err instanceof PublicBookingCreateError) {
      await markIdempotencyFailed(idempotencyRequestId, err.code);
      throw err;
    }
    console.error('[publicBookingCreate]', err);
    await markIdempotencyFailed(idempotencyRequestId, 'BOOKING_CREATE_FAILED');
    throw new PublicBookingCreateError('BOOKING_CREATE_FAILED');
  }
}

/** Expose catalog message helper for routes. */
export function createErrorMessage(code: PublicBookingErrorCode): string {
  return PUBLIC_BOOKING_ERROR_CATALOG[code]?.messageAr ?? code;
}
