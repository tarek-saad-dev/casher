/**
 * Public (customer-owned) booking reschedule / modify.
 * Reuses validateBookingMove + rescheduleBookingMove; never cancel-then-create.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  normalizePublicBookingPhone,
  isValidPhone,
} from '@/lib/publicBookingHelpers';
import { digestNormalizedPhone } from '@/lib/booking/publicBookingAccessToken';
import {
  normalizePublicBookingCode,
  PublicBookingReadError,
} from '@/lib/booking/publicBookingReader';
import {
  createCairoDateTime,
} from '@/lib/bookingDateTime';
import {
  isBookingReschedulable,
  loadBookingForReschedule,
  rescheduleBookingMove,
  validateBookingMove,
  type BookingMoveValidationResult,
} from '@/lib/bookingRescheduleCore';
import { ScheduleConflictError } from '@/lib/scheduleIntegrity';
import { resolvePublicBookingBranchContext } from '@/lib/booking/publicBookingBranchContext';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';
import {
  BOOKING_RESCHEDULE_CONTRACT_VERSION,
  buildRescheduleRequestFingerprint,
  claimRescheduleIdempotencyAutonomous,
  completeRescheduleIdempotencySuccess,
  ensurePublicBookingRescheduleIdempotencyTable,
  markRescheduleIdempotencyFailed,
  RescheduleIdempotencyConflictError,
} from '@/lib/booking/publicBookingRescheduleIdempotency';

export class PublicBookingRescheduleError extends Error {
  readonly code: PublicBookingErrorCode | string;
  readonly metadata: Record<string, unknown>;
  constructor(code: PublicBookingErrorCode | string, metadata: Record<string, unknown> = {}) {
    super(String(code));
    this.name = 'PublicBookingRescheduleError';
    this.code = code;
    this.metadata = metadata;
  }
}

export type ReschedulePublicBookingDesired = {
  workDate: string;
  time: string;
  empId: number;
  branchCode: string;
  serviceIds: number[];
};

export type ReschedulePublicBookingInput = {
  code: string;
  phone: string;
  desired: ReschedulePublicBookingDesired;
  idempotencyKey: string;
  /** When true, skip post-commit customer WhatsApp template (chat reply owns UX). */
  suppressCustomerWhatsApp?: boolean;
};

export type ReschedulePublicBookingResult = {
  ok: true;
  idempotentReplay: boolean;
  bookingId: number;
  bookingCode: string;
  old: {
    startAt: string;
    endAt: string;
    empId: number;
    empName: string | null;
  };
  new: {
    startAt: string;
    endAt: string;
    empId: number;
    empName: string | null;
    workDate: string;
    time: string;
    branchCode: string;
  };
  validation?: BookingMoveValidationResult;
};

async function loadOwnedBookingHead(args: {
  code: string;
  phone: string;
}): Promise<{
  bookingId: number;
  bookingCode: string;
  customerPhone: string;
  status: string;
  branchCode: string | null;
  serviceIds: number[];
}> {
  const code = normalizePublicBookingCode(args.code);
  const phone = normalizePublicBookingPhone(args.phone);
  if (!phone || !isValidPhone(phone)) {
    throw new PublicBookingRescheduleError('INVALID_CUSTOMER_PHONE');
  }

  const db = await getPool();
  const r = await db
    .request()
    .input('code', sql.NVarChar(40), code)
    .query(`
      SELECT
        b.BookingID, b.BookingCode, b.Status, b.BranchID,
        c.Mobile AS CustomerPhone,
        br.BranchCode
      FROM dbo.Bookings b
      INNER JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
      WHERE b.BookingCode = @code
    `);
  const row = r.recordset[0] as
    | {
        BookingID: number;
        BookingCode: string;
        Status: string;
        CustomerPhone: string | null;
        BranchCode: string | null;
      }
    | undefined;
  if (!row) throw new PublicBookingRescheduleError('BOOKING_NOT_FOUND');

  const stored = normalizePublicBookingPhone(String(row.CustomerPhone ?? ''));
  if (!stored || stored !== phone) {
    throw new PublicBookingRescheduleError('BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
  }

  const loaded = await loadBookingForReschedule(Number(row.BookingID));
  if (!loaded) throw new PublicBookingRescheduleError('BOOKING_NOT_FOUND');

  return {
    bookingId: loaded.bookingId,
    bookingCode: String(row.BookingCode).toUpperCase(),
    customerPhone: phone,
    status: loaded.status,
    branchCode: row.BranchCode ? String(row.BranchCode) : null,
    serviceIds: loaded.serviceIds,
  };
}

function sameServiceSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/**
 * Preview desired public modification without writing.
 * Uses ops validateBookingMove (excludes self) after resolving branch.
 */
export async function previewPublicBookingReschedule(input: {
  code: string;
  phone: string;
  desired: ReschedulePublicBookingDesired;
}): Promise<
  | { ok: true; validation: BookingMoveValidationResult; bookingId: number }
  | { ok: false; code: string; message: string; validation?: BookingMoveValidationResult }
> {
  try {
    const head = await loadOwnedBookingHead(input);
    if (!isBookingReschedulable(head.status)) {
      return {
        ok: false,
        code: 'NOT_EDITABLE',
        message: 'الحجز ده مش متاح للتعديل في حالته الحالية.',
      };
    }

    const branch = await resolvePublicBookingBranchContext({
      branchCode: input.desired.branchCode,
      purpose: 'public_booking',
    });

    const servicesChanged = !sameServiceSet(head.serviceIds, input.desired.serviceIds);
    const branchChanged =
      head.branchCode != null &&
      String(head.branchCode).toUpperCase() !== String(input.desired.branchCode).toUpperCase();

    if (servicesChanged) {
      return {
        ok: false,
        code: 'SERVICE_CHANGE_REQUIRES_RECEPTION',
        message:
          'تغيير الخدمات من واتساب لسه بيتفعّل بحذر. قولي التفاصيل وأحوّلك للاستقبال لو محتاجين نعدّل الخدمات.',
      };
    }

    const startAt = createCairoDateTime(input.desired.workDate, input.desired.time);
    const validation = await validateBookingMove({
      bookingId: head.bookingId,
      newStartAt: startAt.toISOString(),
      operationalDate: input.desired.workDate,
      targetEmpId: input.desired.empId,
      targetBranchId: branchChanged ? branch.branchId : undefined,
    });

    if (!validation.valid) {
      return {
        ok: false,
        code: validation.code ?? 'SCHEDULE_CONFLICT',
        message: validation.message ?? 'الميعاد مش متاح.',
        validation,
      };
    }

    return { ok: true, validation, bookingId: head.bookingId };
  } catch (err) {
    if (err instanceof PublicBookingRescheduleError) {
      return { ok: false, code: String(err.code), message: 'مش قادر أتأكد من التعديل دلوقتي.' };
    }
    if (err instanceof PublicBookingReadError) {
      return { ok: false, code: err.code, message: 'مش قادر أتأكد من التعديل دلوقتي.' };
    }
    throw err;
  }
}

export async function reschedulePublicBooking(
  input: ReschedulePublicBookingInput,
): Promise<ReschedulePublicBookingResult> {
  const code = normalizePublicBookingCode(input.code);
  const phone = normalizePublicBookingPhone(input.phone);
  if (!phone || !isValidPhone(phone)) {
    throw new PublicBookingRescheduleError('INVALID_CUSTOMER_PHONE');
  }
  if (!input.idempotencyKey?.trim()) {
    throw new PublicBookingRescheduleError('IDEMPOTENCY_KEY_REQUIRED');
  }

  const head = await loadOwnedBookingHead({ code, phone });
  if (!isBookingReschedulable(head.status)) {
    throw new PublicBookingRescheduleError('NOT_EDITABLE', { status: head.status });
  }

  const servicesChanged = !sameServiceSet(head.serviceIds, input.desired.serviceIds);
  if (servicesChanged) {
    throw new PublicBookingRescheduleError('SERVICE_CHANGE_NOT_SUPPORTED_YET');
  }

  const branch = await resolvePublicBookingBranchContext({
    branchCode: input.desired.branchCode,
    purpose: 'public_booking',
  });
  const branchChanged =
    head.branchCode != null &&
    String(head.branchCode).toUpperCase() !== String(input.desired.branchCode).toUpperCase();

  await ensurePublicBookingRescheduleIdempotencyTable();
  const fingerprint = buildRescheduleRequestFingerprint({
    contractVersion: BOOKING_RESCHEDULE_CONTRACT_VERSION,
    bookingCode: head.bookingCode,
    ownershipDigest: digestNormalizedPhone(phone),
    workDate: input.desired.workDate,
    time: input.desired.time,
    empId: input.desired.empId,
    branchCode: input.desired.branchCode,
    serviceIds: input.desired.serviceIds,
  });

  let requestId: number | null = null;
  try {
    const claim = await claimRescheduleIdempotencyAutonomous({
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      bookingCode: head.bookingCode,
    });
    if (claim.kind === 'replay' && claim.row.ResponseJson) {
      const parsed = JSON.parse(claim.row.ResponseJson) as ReschedulePublicBookingResult;
      return { ...parsed, idempotentReplay: true };
    }
    requestId = claim.kind === 'claimed' ? claim.requestId : null;
  } catch (err) {
    if (err instanceof RescheduleIdempotencyConflictError) {
      throw new PublicBookingRescheduleError(err.code);
    }
    throw err;
  }

  const startAt = createCairoDateTime(input.desired.workDate, input.desired.time);

  try {
    const moved = await rescheduleBookingMove({
      bookingId: head.bookingId,
      newStartAt: startAt.toISOString(),
      operationalDate: input.desired.workDate,
      source: 'whatsapp_ai_management',
      userId: 0,
      targetEmpId: input.desired.empId,
      targetBranchId: branchChanged ? branch.branchId : undefined,
      skipCustomerWhatsApp: input.suppressCustomerWhatsApp !== false,
    });

    const body: ReschedulePublicBookingResult = {
      ok: true,
      idempotentReplay: false,
      bookingId: moved.bookingId,
      bookingCode: head.bookingCode,
      old: {
        startAt: moved.oldStartAt,
        endAt: moved.oldEndAt,
        empId: moved.oldEmpId,
        empName: moved.oldEmpName,
      },
      new: {
        startAt: moved.newStartAt,
        endAt: moved.newEndAt,
        empId: moved.newEmpId,
        empName: moved.newEmpName,
        workDate: input.desired.workDate,
        time: input.desired.time,
        branchCode: input.desired.branchCode,
      },
    };

    if (requestId != null) {
      await completeRescheduleIdempotencySuccess(requestId, JSON.stringify(body));
    }
    return body;
  } catch (err) {
    const codeStr =
      err instanceof ScheduleConflictError
        ? err.code || 'SCHEDULE_CONFLICT'
        : err instanceof Error
          ? err.message.slice(0, 64)
          : 'RESCHEDULE_FAILED';
    await markRescheduleIdempotencyFailed(requestId, codeStr);
    if (err instanceof ScheduleConflictError) {
      throw new PublicBookingRescheduleError(err.code || 'SCHEDULE_CONFLICT', {
        conflict: err.conflict,
        message: err.message,
      });
    }
    throw err;
  }
}
