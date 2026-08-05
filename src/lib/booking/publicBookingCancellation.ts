/**
 * Booking Phase 7B — canonical public booking cancellation.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  normalizePublicBookingPhone,
  isValidPhone,
} from '@/lib/publicBookingHelpers';
import {
  digestNormalizedPhone,
  verifyBookingAccessToken,
} from '@/lib/booking/publicBookingAccessToken';
import {
  mapPublicBookingStatus,
} from '@/lib/booking/publicBookingStatus';
import {
  normalizePublicBookingCode,
  PublicBookingReadError,
} from '@/lib/booking/publicBookingReader';
import {
  resolvePublicCancellationCutoff,
  isApprovedReasonCode,
  PUBLIC_CANCELLATION_CUTOFF_MINUTES,
} from '@/lib/booking/publicBookingCancellationPolicy';
import {
  isPublicBookingEnforceMode,
  logLegacyContractUsed,
} from '@/lib/booking/publicBookingContractMode';
import {
  BOOKING_CANCEL_CONTRACT_VERSION,
  buildCancelRequestFingerprint,
  claimCancelIdempotencyAutonomous,
  completeCancelIdempotencySuccess,
  ensurePublicBookingCancelColumns,
  ensurePublicBookingCancelIdempotencyTable,
  markCancelIdempotencyFailed,
  CancelIdempotencyConflictError,
} from '@/lib/booking/publicBookingCancelIdempotency';
import {
  acquireBookingAppLock,
  empIntervalLockResource,
  BookingCreateLockError,
} from '@/lib/booking/publicBookingCreateLocks';
import { invalidatePublicBookingAvailabilityCache } from '@/lib/booking/publicBookingAvailability';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';
import { isTestOrSmokeEmployeeName } from '@/lib/hr/testEmployeePolicy';
import { buildBookingIntervals } from '@/lib/queueEstimateEngine';

const MAX_REASON_TEXT = 250;
const INTERNAL_SOURCES = new Set([
  'smoke_seed',
  'phase1n-smoke',
  'internal_preview',
  'operations',
]);

export class PublicBookingCancelError extends Error {
  readonly code: PublicBookingErrorCode;
  readonly metadata: Record<string, unknown>;
  constructor(code: PublicBookingErrorCode, metadata: Record<string, unknown> = {}) {
    super(code);
    this.name = 'PublicBookingCancelError';
    this.code = code;
    this.metadata = metadata;
  }
}

export type CancelPublicBookingInput = {
  code: string;
  phone?: string | null;
  accessToken?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  clientRequestId?: string | null;
  idempotencyKey?: string | null;
  /** Allow absent key only for documented legacy smoke; production routes require key. */
  allowMissingIdempotencyKey?: boolean;
  requestContext?: { ip?: string; userAgent?: string };
};

export type CancelPublicBookingResult = {
  httpStatus: number;
  body: {
    ok: true;
    cancellation: {
      code: string;
      status: 'cancelled';
      statusLabel: string;
      cancelledAt: string | null;
      reasonCode: string | null;
      alreadyCancelled?: boolean;
      idempotentReplay: boolean;
    };
    booking: {
      code: string;
      branch: { branchCode: string; branchName: string } | null;
      barber: { empId: number | null; nameAr: string | null } | null;
      workDate: string | null;
      calendarDate: string | null;
      time: string | null;
      dayOffset: 0 | 1 | null;
      status: 'cancelled';
      canCancel: false;
    };
    slotRelease: {
      bookingBlockRemoved: boolean;
      currentlyAvailable: boolean | null;
      availabilityReason: string | null;
    };
  };
};

type BookingCancelRow = {
  BookingID: number;
  BookingCode: string;
  BranchID: number | null;
  BranchCode: string | null;
  BranchName: string | null;
  Status: string | null;
  Source: string | null;
  Notes: string | null;
  CustomerName: string | null;
  CustomerPhone: string | null;
  AssignedEmpID: number | null;
  BarberName: string | null;
  BookingDate: Date | string | null;
  StartTime: unknown;
  PublicWorkDate: Date | string | null;
  PublicDayOffset: number | null;
  AbsoluteStartUtc: Date | string | null;
  AbsoluteEndUtc: Date | string | null;
  CancelledAt: Date | string | null;
  PublicCancelledAtUtc: Date | string | null;
  PublicCancellationReasonCode: string | null;
  InvoiceID: number | null;
};

function ymd(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  try {
    return new Date(String(v)).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function hhmm(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const m = v.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : null;
  }
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

function nextYmd(ymdStr: string): string {
  const d = new Date(`${ymdStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function isPublicOriginBooking(row: BookingCancelRow): boolean {
  const source = String(row.Source ?? '')
    .trim()
    .toLowerCase();
  if (INTERNAL_SOURCES.has(source)) return false;
  const notes = String(row.Notes ?? '');
  if (/\[SMOKE/i.test(notes)) return false;
  if (String(row.BookingCode ?? '').toUpperCase().startsWith('P6C-')) return false;
  if (source === 'online' || source === 'website' || source === 'phone' || source === 'whatsapp') {
    return true;
  }
  if (isTestOrSmokeEmployeeName(row.BarberName)) return false;
  if (isTestOrSmokeEmployeeName(row.CustomerName)) return false;
  return source === '' || source === 'admin' || source === 'walk_in';
}

function deriveDateSource(row: BookingCancelRow): {
  workDate: string | null;
  calendarDate: string | null;
  time: string | null;
  dayOffset: 0 | 1 | null;
  dateSource: 'canonical' | 'legacy_derived' | 'ambiguous';
} {
  const publicWork = ymd(row.PublicWorkDate);
  const dayOff =
    row.PublicDayOffset === 0 || row.PublicDayOffset === 1
      ? (Number(row.PublicDayOffset) as 0 | 1)
      : null;
  const absStart = row.AbsoluteStartUtc ? new Date(row.AbsoluteStartUtc) : null;
  const startT = hhmm(row.StartTime);

  if (publicWork && dayOff != null && absStart && !Number.isNaN(absStart.getTime())) {
    return {
      workDate: publicWork,
      calendarDate: dayOff === 1 ? nextYmd(publicWork) : publicWork,
      time: startT,
      dayOffset: dayOff,
      dateSource: 'canonical',
    };
  }

  const bookingDate = ymd(row.BookingDate);
  if (bookingDate && startT) {
    const [h] = startT.split(':').map(Number);
    if (h < 5 && !publicWork) {
      return {
        workDate: null,
        calendarDate: bookingDate,
        time: startT,
        dayOffset: null,
        dateSource: 'ambiguous',
      };
    }
    return {
      workDate: bookingDate,
      calendarDate: bookingDate,
      time: startT,
      dayOffset: 0,
      dateSource: 'legacy_derived',
    };
  }

  return {
    workDate: publicWork,
    calendarDate: bookingDate,
    time: startT,
    dayOffset: dayOff,
    dateSource: 'ambiguous',
  };
}

async function loadBookingByCode(
  makeRequest: () => sql.Request,
  code: string,
): Promise<BookingCancelRow | null> {
  const r = await makeRequest().input('code', sql.NVarChar(32), code).query(`
    SELECT TOP 1
      b.BookingID,
      b.BookingCode,
      b.BranchID,
      br.BranchCode,
      br.BranchName,
      b.Status,
      b.Source,
      b.Notes,
      c.[Name] AS CustomerName,
      c.Mobile AS CustomerPhone,
      b.AssignedEmpID,
      e.EmpName AS BarberName,
      b.BookingDate,
      b.StartTime,
      b.PublicWorkDate,
      b.PublicDayOffset,
      b.AbsoluteStartUtc,
      b.AbsoluteEndUtc,
      b.CancelledAt,
      b.PublicCancelledAtUtc,
      b.PublicCancellationReasonCode,
      CAST(NULL AS INT) AS InvoiceID
    FROM dbo.Bookings b
    LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
    LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
    LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
    WHERE b.BookingCode = @code
  `);
  return (r.recordset[0] as BookingCancelRow | undefined) ?? null;
}

function resolveOwnership(args: {
  row: BookingCancelRow;
  phone?: string | null;
  accessToken?: string | null;
}): { ok: true; ownershipDigest: string; normalizedPhone: string } | { ok: false; code: PublicBookingErrorCode } {
  const storedPhone = normalizePublicBookingPhone(String(args.row.CustomerPhone ?? ''));
  let inputPhone: string | null = null;

  if (args.phone != null && String(args.phone).trim() !== '') {
    inputPhone = normalizePublicBookingPhone(String(args.phone));
    if (!inputPhone || !isValidPhone(inputPhone)) {
      return { ok: false, code: 'INVALID_CUSTOMER_PHONE' };
    }
  }

  if (args.accessToken) {
    const verified = verifyBookingAccessToken({
      token: String(args.accessToken),
      bookingCode: String(args.row.BookingCode ?? ''),
      normalizedPhone: inputPhone || undefined,
    });
    if (!verified.ok) {
      if (verified.reason === 'expired') {
        return { ok: false, code: 'BOOKING_ACCESS_TOKEN_EXPIRED' };
      }
      return { ok: false, code: 'BOOKING_ACCESS_TOKEN_INVALID' };
    }
    if (inputPhone && digestNormalizedPhone(inputPhone) !== verified.claims.phoneDigest) {
      return { ok: false, code: 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED' };
    }
    if (!inputPhone) {
      if (!storedPhone || digestNormalizedPhone(storedPhone) !== verified.claims.phoneDigest) {
        return { ok: false, code: 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED' };
      }
    }
    const normalizedPhone = inputPhone || storedPhone;
    return {
      ok: true,
      ownershipDigest: digestNormalizedPhone(normalizedPhone),
      normalizedPhone,
    };
  }

  if (inputPhone) {
    if (!storedPhone || storedPhone !== inputPhone) {
      return { ok: false, code: 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED' };
    }
    return {
      ok: true,
      ownershipDigest: digestNormalizedPhone(inputPhone),
      normalizedPhone: inputPhone,
    };
  }

  return { ok: false, code: 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED' };
}

function mapCutoffToError(
  reason: ReturnType<typeof resolvePublicCancellationCutoff>['reason'],
): PublicBookingErrorCode {
  switch (reason) {
    case 'already_cancelled':
      return 'BOOKING_ALREADY_CANCELLED';
    case 'in_service':
      return 'BOOKING_ALREADY_IN_SERVICE';
    case 'completed':
      return 'BOOKING_ALREADY_COMPLETED';
    case 'window_closed':
      return 'BOOKING_CANCELLATION_WINDOW_CLOSED';
    case 'ambiguous_start':
      return 'BOOKING_CANCELLATION_REQUIRES_STAFF';
    case 'no_show':
    case 'unknown_status':
    case 'status_not_cancellable':
      return 'BOOKING_NOT_CANCELLABLE';
    default:
      return 'BOOKING_NOT_CANCELLABLE';
  }
}

function cancelLockResource(code: string): string {
  return `booking:cancel:${code}`;
}

async function probeSlotRelease(args: {
  bookingId: number;
  empId: number | null;
  workDate: string | null;
  calendarDate: string | null;
  startMs: number | null;
  endMs: number | null;
}): Promise<{
  bookingBlockRemoved: boolean;
  currentlyAvailable: boolean | null;
  availabilityReason: string | null;
}> {
  if (args.empId == null) {
    return {
      bookingBlockRemoved: true,
      currentlyAvailable: null,
      availabilityReason: null,
    };
  }

  const db = await getPool();
  const dates = [...new Set([args.workDate, args.calendarDate].filter(Boolean) as string[])];
  let stillBlocking = false;
  for (const d of dates) {
    const intervals = await buildBookingIntervals(db, args.empId, d, 30, { failHard: false });
    if (intervals.some((iv) => iv.id === args.bookingId)) {
      stillBlocking = true;
      break;
    }
  }

  if (stillBlocking) {
    return {
      bookingBlockRemoved: false,
      currentlyAvailable: false,
      availabilityReason: 'CANCELLED_STILL_BLOCKING',
    };
  }

  let currentlyAvailable: boolean | null = null;
  let availabilityReason: string | null = null;
  if (args.startMs != null && args.endMs != null && args.workDate) {
    try {
      const { assertEmployeeIntervalAvailable } = await import('@/lib/scheduleIntegrity');
      await assertEmployeeIntervalAvailable({
        empId: args.empId,
        startAt: new Date(args.startMs),
        endAt: new Date(args.endMs),
        operationalDate: args.workDate,
        excludeBookingId: args.bookingId,
      });
      currentlyAvailable = true;
    } catch (err) {
      currentlyAvailable = false;
      const { ScheduleConflictError } = await import('@/lib/scheduleIntegrity');
      if (err instanceof ScheduleConflictError) {
        availabilityReason =
          err.conflict?.type === 'queue'
            ? 'QUEUE_BUSY'
            : err.conflict?.type?.toUpperCase() || 'OTHER_BLOCKER';
      } else {
        availabilityReason = 'OTHER_BLOCKER';
      }
    }
  }

  return {
    bookingBlockRemoved: true,
    currentlyAvailable,
    availabilityReason,
  };
}

function buildSuccessBody(args: {
  code: string;
  cancelledAt: string | null;
  reasonCode: string | null;
  alreadyCancelled: boolean;
  idempotentReplay: boolean;
  branchCode: string | null;
  branchName: string | null;
  empId: number | null;
  barberName: string | null;
  workDate: string | null;
  calendarDate: string | null;
  time: string | null;
  dayOffset: 0 | 1 | null;
  slotRelease: CancelPublicBookingResult['body']['slotRelease'];
}): CancelPublicBookingResult['body'] {
  const statusMapped = mapPublicBookingStatus('cancelled');
  return {
    ok: true,
    cancellation: {
      code: args.code,
      status: 'cancelled',
      statusLabel: statusMapped.statusLabelAr,
      cancelledAt: args.cancelledAt,
      reasonCode: args.reasonCode,
      ...(args.alreadyCancelled ? { alreadyCancelled: true } : {}),
      idempotentReplay: args.idempotentReplay,
    },
    booking: {
      code: args.code,
      branch:
        args.branchCode && args.branchName
          ? { branchCode: args.branchCode, branchName: args.branchName }
          : null,
      barber: { empId: args.empId, nameAr: args.barberName },
      workDate: args.workDate,
      calendarDate: args.calendarDate,
      time: args.time,
      dayOffset: args.dayOffset,
      status: 'cancelled',
      canCancel: false,
    },
    slotRelease: args.slotRelease,
  };
}

/**
 * Canonical public cancellation entry point.
 * Both POST /api/public/booking/cancel and …/[code]/cancel must call this.
 */
export async function cancelPublicBooking(
  input: CancelPublicBookingInput,
): Promise<CancelPublicBookingResult> {
  await ensurePublicBookingCancelIdempotencyTable();
  await ensurePublicBookingCancelColumns();

  let code: string;
  try {
    code = normalizePublicBookingCode(input.code);
  } catch (err) {
    if (err instanceof PublicBookingReadError) {
      throw new PublicBookingCancelError(err.code);
    }
    throw new PublicBookingCancelError('INVALID_BOOKING_CODE');
  }

  const hasPhone = !!(input.phone && String(input.phone).trim());
  const hasToken = !!(input.accessToken && String(input.accessToken).trim());
  if (!hasPhone && !hasToken) {
    throw new PublicBookingCancelError('BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
  }

  let reasonCode: string | null = null;
  if (input.reasonCode != null && String(input.reasonCode).trim()) {
    if (!isApprovedReasonCode(String(input.reasonCode).trim())) {
      throw new PublicBookingCancelError('BOOKING_CANCELLATION_FAILED', {
        reason: 'invalid_reason_code',
      });
    }
    reasonCode = String(input.reasonCode).trim();
  }

  let reasonText: string | null = null;
  if (input.reasonText != null && String(input.reasonText).trim()) {
    reasonText = String(input.reasonText).trim().slice(0, MAX_REASON_TEXT);
  }

  const idempotencyKey = String(
    input.idempotencyKey || input.clientRequestId || '',
  ).trim();
  if (isPublicBookingEnforceMode()) {
    if (!idempotencyKey) {
      throw new PublicBookingCancelError('IDEMPOTENCY_KEY_REQUIRED');
    }
  } else if (!idempotencyKey && !input.allowMissingIdempotencyKey) {
    throw new PublicBookingCancelError('IDEMPOTENCY_KEY_REQUIRED');
  } else if (!idempotencyKey && input.allowMissingIdempotencyKey) {
    logLegacyContractUsed({
      routeFamily: 'cancel',
      missingRequirement: 'idempotencyKey',
    });
  }

  // Preload for fingerprint ownership digest (best-effort; TX revalidates).
  const db = await getPool();
  const pre = await loadBookingByCode(() => db.request(), code);
  if (!pre || !isPublicOriginBooking(pre)) {
    throw new PublicBookingCancelError('BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
  }

  const ownershipPre = resolveOwnership({
    row: pre,
    phone: input.phone,
    accessToken: input.accessToken,
  });
  if (!ownershipPre.ok) {
    throw new PublicBookingCancelError(ownershipPre.code);
  }

  // Already cancelled → idempotent business result (no mutation).
  const preMapped = mapPublicBookingStatus(pre.Status);
  if (preMapped.status === 'cancelled') {
    const dates = deriveDateSource(pre);
    const cancelledAt =
      pre.PublicCancelledAtUtc != null
        ? new Date(pre.PublicCancelledAtUtc).toISOString()
        : pre.CancelledAt != null
          ? new Date(pre.CancelledAt).toISOString()
          : null;
    const slotRelease = await probeSlotRelease({
      bookingId: pre.BookingID,
      empId: pre.AssignedEmpID,
      workDate: dates.workDate,
      calendarDate: dates.calendarDate,
      startMs: pre.AbsoluteStartUtc ? new Date(pre.AbsoluteStartUtc).getTime() : null,
      endMs: pre.AbsoluteEndUtc ? new Date(pre.AbsoluteEndUtc).getTime() : null,
    });
    return {
      httpStatus: 200,
      body: buildSuccessBody({
        code,
        cancelledAt,
        reasonCode: pre.PublicCancellationReasonCode,
        alreadyCancelled: true,
        idempotentReplay: true,
        branchCode: pre.BranchCode,
        branchName: pre.BranchName,
        empId: pre.AssignedEmpID,
        barberName: pre.BarberName,
        workDate: dates.workDate,
        calendarDate: dates.calendarDate,
        time: dates.time,
        dayOffset: dates.dayOffset,
        slotRelease,
      }),
    };
  }

  let cancelRequestId: number | null = null;
  let claimedKey = idempotencyKey;

  if (idempotencyKey) {
    try {
      const claim = await claimCancelIdempotencyAutonomous({
        idempotencyKey,
        requestFingerprint: buildCancelRequestFingerprint({
          contractVersion: BOOKING_CANCEL_CONTRACT_VERSION,
          bookingCode: code,
          ownershipDigest: ownershipPre.ownershipDigest,
          reasonCode,
          reasonText,
        }),
        bookingCode: code,
      });
      if (claim.kind === 'replay') {
        const parsed = JSON.parse(claim.row.ResponseJson!) as CancelPublicBookingResult['body'];
        return { httpStatus: 200, body: { ...parsed, cancellation: { ...parsed.cancellation, idempotentReplay: true } } };
      }
      cancelRequestId = claim.requestId;
    } catch (err) {
      if (err instanceof CancelIdempotencyConflictError) {
        throw new PublicBookingCancelError(err.code);
      }
      throw err;
    }
  } else {
    claimedKey = `legacy-${code}-${Date.now()}`;
  }

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    await acquireBookingAppLock(transaction, cancelLockResource(code));

    const row = await loadBookingByCode(() => new sql.Request(transaction), code);
    if (!row || !isPublicOriginBooking(row)) {
      throw new PublicBookingCancelError('BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
    }

    const ownership = resolveOwnership({
      row,
      phone: input.phone,
      accessToken: input.accessToken,
    });
    if (!ownership.ok) {
      throw new PublicBookingCancelError(ownership.code);
    }

    const dates = deriveDateSource(row);
    const mapped = mapPublicBookingStatus(row.Status);

    if (mapped.status === 'cancelled') {
      const cancelledAt =
        row.PublicCancelledAtUtc != null
          ? new Date(row.PublicCancelledAtUtc).toISOString()
          : row.CancelledAt != null
            ? new Date(row.CancelledAt).toISOString()
            : null;
      const body = buildSuccessBody({
        code,
        cancelledAt,
        reasonCode: row.PublicCancellationReasonCode,
        alreadyCancelled: true,
        idempotentReplay: true,
        branchCode: row.BranchCode,
        branchName: row.BranchName,
        empId: row.AssignedEmpID,
        barberName: row.BarberName,
        workDate: dates.workDate,
        calendarDate: dates.calendarDate,
        time: dates.time,
        dayOffset: dates.dayOffset,
        slotRelease: {
          bookingBlockRemoved: true,
          currentlyAvailable: null,
          availabilityReason: null,
        },
      });
      if (cancelRequestId != null) {
        await completeCancelIdempotencySuccess(transaction, {
          requestId: cancelRequestId,
          responseJson: JSON.stringify(body),
        });
      }
      await transaction.commit();
      return { httpStatus: 200, body };
    }

    // Payment / deposit — no public payment columns in create path; InvoiceID stubbed null.
    if (row.InvoiceID != null) {
      throw new PublicBookingCancelError('BOOKING_HAS_PAYMENT');
    }

    const cutoff = resolvePublicCancellationCutoff({
      statusRaw: row.Status,
      absoluteStartUtc: row.AbsoluteStartUtc,
      dateSource: dates.dateSource,
    });
    if (!cutoff.windowOpen) {
      throw new PublicBookingCancelError(mapCutoffToError(cutoff.reason), {
        cutoffMinutes: PUBLIC_CANCELLATION_CUTOFF_MINUTES,
      });
    }

    const startMs = row.AbsoluteStartUtc ? new Date(row.AbsoluteStartUtc).getTime() : null;
    const endMs = row.AbsoluteEndUtc ? new Date(row.AbsoluteEndUtc).getTime() : null;
    if (row.AssignedEmpID != null && startMs != null && endMs != null) {
      await acquireBookingAppLock(
        transaction,
        empIntervalLockResource(row.AssignedEmpID, startMs, endMs),
      );
    }

    // Re-check status after emp lock (service-start race).
    const recheck = await new sql.Request(transaction)
      .input('id', sql.Int, row.BookingID)
      .query(`SELECT Status FROM dbo.Bookings WHERE BookingID = @id`);
    const statusNow = recheck.recordset[0]?.Status;
    const mappedNow = mapPublicBookingStatus(statusNow);
    if (mappedNow.status === 'cancelled') {
      const body = buildSuccessBody({
        code,
        cancelledAt: new Date().toISOString(),
        reasonCode: row.PublicCancellationReasonCode,
        alreadyCancelled: true,
        idempotentReplay: true,
        branchCode: row.BranchCode,
        branchName: row.BranchName,
        empId: row.AssignedEmpID,
        barberName: row.BarberName,
        workDate: dates.workDate,
        calendarDate: dates.calendarDate,
        time: dates.time,
        dayOffset: dates.dayOffset,
        slotRelease: {
          bookingBlockRemoved: true,
          currentlyAvailable: null,
          availabilityReason: null,
        },
      });
      if (cancelRequestId != null) {
        await completeCancelIdempotencySuccess(transaction, {
          requestId: cancelRequestId,
          responseJson: JSON.stringify(body),
        });
      }
      await transaction.commit();
      return { httpStatus: 200, body };
    }
    if (!mappedNow.canCancel) {
      throw new PublicBookingCancelError(mapCutoffToError(
        mappedNow.status === 'in_service'
          ? 'in_service'
          : mappedNow.status === 'completed'
            ? 'completed'
            : 'status_not_cancellable',
      ));
    }

    const cancelReason =
      reasonCode
        ? `public:${reasonCode}${reasonText ? ` — ${reasonText}` : ''}`
        : reasonText || 'Cancelled by customer (public)';

    await new sql.Request(transaction)
      .input('id', sql.Int, row.BookingID)
      .input('reason', sql.NVarChar(500), cancelReason.slice(0, 500))
      .input('reasonCode', sql.NVarChar(64), reasonCode)
      .input('reasonText', sql.NVarChar(250), reasonText)
      .input('reqId', sql.BigInt, cancelRequestId)
      .query(`
        UPDATE dbo.Bookings
        SET
          Status = N'cancelled',
          CancelledAt = SYSUTCDATETIME(),
          CancelReason = @reason,
          PublicCancelledAtUtc = SYSUTCDATETIME(),
          PublicCancellationReasonCode = @reasonCode,
          PublicCancellationReasonText = @reasonText,
          PublicCancellationSource = N'customer_public',
          PublicCancellationRequestID = @reqId,
          UpdatedAt = SYSUTCDATETIME()
        WHERE BookingID = @id
          AND LOWER(Status) IN (N'confirmed', N'pending', N'rescheduled')
      `);

    const verify = await new sql.Request(transaction)
      .input('id', sql.Int, row.BookingID)
      .query(`
        SELECT Status, PublicCancelledAtUtc
        FROM dbo.Bookings WHERE BookingID = @id
      `);
    const after = verify.recordset[0];
    if (mapPublicBookingStatus(after?.Status).status !== 'cancelled') {
      throw new PublicBookingCancelError(mapCutoffToError(
        mapPublicBookingStatus(after?.Status).status === 'in_service'
          ? 'in_service'
          : 'status_not_cancellable',
      ));
    }

    const cancelledAt = after?.PublicCancelledAtUtc
      ? new Date(after.PublicCancelledAtUtc).toISOString()
      : new Date().toISOString();

    const bodyStub = buildSuccessBody({
      code,
      cancelledAt,
      reasonCode,
      alreadyCancelled: false,
      idempotentReplay: false,
      branchCode: row.BranchCode,
      branchName: row.BranchName,
      empId: row.AssignedEmpID,
      barberName: row.BarberName,
      workDate: dates.workDate,
      calendarDate: dates.calendarDate,
      time: dates.time,
      dayOffset: dates.dayOffset,
      slotRelease: {
        bookingBlockRemoved: true,
        currentlyAvailable: null,
        availabilityReason: null,
      },
    });

    if (cancelRequestId != null) {
      await completeCancelIdempotencySuccess(transaction, {
        requestId: cancelRequestId,
        responseJson: JSON.stringify(bodyStub),
      });
    }

    await transaction.commit();

    // Post-commit WhatsApp cancel (idempotent; never blocks cancel success).
    try {
      const { scheduleCancelWhatsAppAfterCommit } = await import(
        '@/lib/booking/bookingEventWhatsApp'
      );
      await scheduleCancelWhatsAppAfterCommit(row.BookingID);
    } catch {
      /* best-effort */
    }

    // Post-commit: cache + slot probe (never inside TX).
    invalidatePublicBookingAvailabilityCache();
    try {
      const { invalidatePublicBookingBarberRelatedCaches } = await import(
        '@/lib/booking/publicBookingBarbers'
      );
      invalidatePublicBookingBarberRelatedCaches();
    } catch {
      /* optional */
    }

    const slotRelease = await probeSlotRelease({
      bookingId: row.BookingID,
      empId: row.AssignedEmpID,
      workDate: dates.workDate,
      calendarDate: dates.calendarDate,
      startMs,
      endMs,
    });

    const body = {
      ...bodyStub,
      slotRelease,
    };

    // Refresh stored response with slot probe (best-effort, outside cancel TX).
    if (cancelRequestId != null) {
      try {
        await db
          .request()
          .input('id', sql.BigInt, cancelRequestId)
          .input('json', sql.NVarChar(sql.MAX), JSON.stringify(body))
          .query(`
            UPDATE dbo.TblPublicBookingCancelRequest
            SET ResponseJson = @json
            WHERE CancelRequestID = @id
          `);
      } catch {
        /* ignore */
      }
    }

    void claimedKey; // retained for smoke/debug correlation
    return { httpStatus: 200, body };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    if (err instanceof BookingCreateLockError) {
      await markCancelIdempotencyFailed(cancelRequestId, err.code);
      throw new PublicBookingCancelError(err.code);
    }
    if (err instanceof PublicBookingCancelError) {
      await markCancelIdempotencyFailed(cancelRequestId, err.code);
      throw err;
    }
    await markCancelIdempotencyFailed(cancelRequestId, 'BOOKING_CANCELLATION_FAILED');
    throw new PublicBookingCancelError('BOOKING_CANCELLATION_FAILED');
  }
}
