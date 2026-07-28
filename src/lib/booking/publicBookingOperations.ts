/**
 * Booking Phase 9A — public booking operations (admin): branch status + pause/resume.
 * Pause toggles QueueBookingSettings.BookingEnabled only — never PublicBookingEnabled / lifecycle.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  executeAuditedAction,
  isAuditedActionError,
} from '@/lib/sensitiveActionAudit';
import type { SessionUser } from '@/lib/session-types';
import { invalidatePublicSettingsCache } from '@/lib/publicBookingHelpers';
import { invalidatePublicBookingBranchContextCache } from '@/lib/booking/publicBookingBranchContext';
import {
  ensurePublicBookingHealthSampleTable,
  type PublicBookingHealthOutcome,
  type PublicBookingHealthTimingFamily,
} from '@/lib/booking/publicBookingHealthMetrics';

/** Only this branch may be paused/resumed from the ops dashboard. */
export const PUBLIC_BOOKING_OPS_CONTROLLABLE_BRANCH = 'GLEEM';

export type PublicBookingOpsBranchStatus = {
  branchId: number;
  branchCode: string;
  branchName: string;
  lifecycleStatus: string;
  isActive: boolean;
  publicBookingEnabled: boolean;
  bookingEnabled: boolean;
  publiclyDiscoverable: boolean;
  canPauseResume: boolean;
  /** True when branch must never be publicly enabled from this UI. */
  publicEnableForbidden: boolean;
};

export type PublicBookingHealthSampleRow = {
  createdAtUtc: string;
  routeFamily: PublicBookingHealthTimingFamily | string;
  routeKey: string;
  outcome: PublicBookingHealthOutcome | string;
  errorCode: string | null;
  durationMs: number;
  httpStatus: number;
};

function isTruthyBit(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

/**
 * Branch public-booking flags for ops dashboard.
 * Includes non-public branches (e.g. Camp Caesar) as read-only confirmation they stay hidden.
 */
export async function listPublicBookingOpsBranchStatuses(): Promise<
  PublicBookingOpsBranchStatus[]
> {
  const db = await getPool();
  const result = await db.request().query(`
    SELECT
      b.BranchID,
      b.BranchCode,
      b.BranchName,
      ISNULL(b.LifecycleStatus, N'SETUP') AS LifecycleStatus,
      CAST(ISNULL(b.IsActive, 0) AS BIT) AS IsActive,
      CAST(ISNULL(b.PublicBookingEnabled, 0) AS BIT) AS PublicBookingEnabled,
      CAST(ISNULL(q.BookingEnabled, 0) AS BIT) AS BookingEnabled
    FROM dbo.TblBranch b
    LEFT JOIN dbo.QueueBookingSettings q ON q.BranchID = b.BranchID
    WHERE b.BranchCode IN (N'GLEEM', N'CAMP_CAESAR')
       OR ISNULL(b.LifecycleStatus, N'') = N'PUBLIC_LIVE'
    ORDER BY
      CASE WHEN b.BranchCode = N'GLEEM' THEN 0
           WHEN b.BranchCode = N'CAMP_CAESAR' THEN 2
           ELSE 1 END,
      b.BranchCode
  `);

  return (result.recordset as Array<Record<string, unknown>>).map((row) => {
    const branchCode = String(row.BranchCode || '').toUpperCase();
    const lifecycleStatus = String(row.LifecycleStatus || 'SETUP');
    const isActive = isTruthyBit(row.IsActive);
    const publicBookingEnabled = isTruthyBit(row.PublicBookingEnabled);
    const bookingEnabled = isTruthyBit(row.BookingEnabled);
    const publiclyDiscoverable =
      lifecycleStatus === 'PUBLIC_LIVE' &&
      isActive &&
      publicBookingEnabled &&
      bookingEnabled;
    const publicEnableForbidden =
      branchCode === 'CAMP_CAESAR' || lifecycleStatus !== 'PUBLIC_LIVE';
    const canPauseResume =
      branchCode === PUBLIC_BOOKING_OPS_CONTROLLABLE_BRANCH &&
      lifecycleStatus === 'PUBLIC_LIVE' &&
      !publicEnableForbidden;

    return {
      branchId: Number(row.BranchID),
      branchCode,
      branchName: String(row.BranchName || ''),
      lifecycleStatus,
      isActive,
      publicBookingEnabled,
      bookingEnabled,
      publiclyDiscoverable,
      canPauseResume,
      publicEnableForbidden,
    };
  });
}

export async function listRecentPublicBookingHealthSamples(
  limit = 25,
): Promise<PublicBookingHealthSampleRow[]> {
  await ensurePublicBookingHealthSampleTable();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const db = await getPool();
  const result = await db
    .request()
    .input('limit', sql.Int, safeLimit)
    .query(`
      SELECT TOP (@limit)
        CreatedAtUtc, RouteFamily, RouteKey, Outcome, ErrorCode, DurationMs, HttpStatus
      FROM dbo.TblPublicBookingHealthSample
      ORDER BY SampleID DESC
    `);

  return (
    (result.recordset as Array<Record<string, unknown>>) || []
  ).map((row) => ({
    createdAtUtc:
      row.CreatedAtUtc instanceof Date
        ? row.CreatedAtUtc.toISOString()
        : String(row.CreatedAtUtc || ''),
    routeFamily: String(row.RouteFamily || 'other'),
    routeKey: String(row.RouteKey || ''),
    outcome: String(row.Outcome || ''),
    errorCode: row.ErrorCode != null ? String(row.ErrorCode) : null,
    durationMs: Number(row.DurationMs) || 0,
    httpStatus: Number(row.HttpStatus) || 0,
  }));
}

export type SetPublicBookingEnabledResult = {
  branchCode: string;
  bookingEnabled: boolean;
  auditId: number;
};

/**
 * Pause/resume public booking via QueueBookingSettings.BookingEnabled.
 * Hard-rejects Camp Caesar and any non-controllable branch.
 */
export async function setPublicBookingOpsEnabled(args: {
  branchCode: string;
  bookingEnabled: boolean;
  reason: string;
  user: SessionUser;
  request?: Request;
}): Promise<SetPublicBookingEnabledResult> {
  const branchCode = String(args.branchCode || '')
    .trim()
    .toUpperCase();
  const reason = String(args.reason || '').trim();

  if (branchCode === 'CAMP_CAESAR') {
    throw new PublicBookingOpsError(
      'CAMP_CAESAR_PUBLIC_ENABLE_FORBIDDEN',
      'لا يمكن تفعيل أو إيقاف الحجز العام لفرع كامب شيزار من هذه الشاشة',
      403,
    );
  }
  if (branchCode !== PUBLIC_BOOKING_OPS_CONTROLLABLE_BRANCH) {
    throw new PublicBookingOpsError(
      'BRANCH_NOT_CONTROLLABLE',
      'الإيقاف/التشغيل متاح لفرع جليم فقط في هذه المرحلة',
      400,
    );
  }
  if (reason.length < 3) {
    throw new PublicBookingOpsError(
      'REASON_REQUIRED',
      'سبب الإجراء مطلوب (٣ أحرف على الأقل)',
      400,
    );
  }

  const db = await getPool();
  const branchRow = await db
    .request()
    .input('code', sql.NVarChar(32), branchCode)
    .query(`
      SELECT TOP 1
        BranchID, BranchCode,
        ISNULL(LifecycleStatus, N'SETUP') AS LifecycleStatus,
        CAST(ISNULL(IsActive, 0) AS BIT) AS IsActive,
        CAST(ISNULL(PublicBookingEnabled, 0) AS BIT) AS PublicBookingEnabled
      FROM dbo.TblBranch
      WHERE BranchCode = @code
    `);
  const branch = branchRow.recordset[0] as
    | {
        BranchID: number;
        BranchCode: string;
        LifecycleStatus: string;
        IsActive: boolean;
        PublicBookingEnabled: boolean;
      }
    | undefined;
  if (!branch) {
    throw new PublicBookingOpsError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 404);
  }
  if (String(branch.LifecycleStatus) !== 'PUBLIC_LIVE' || !isTruthyBit(branch.IsActive)) {
    throw new PublicBookingOpsError(
      'BRANCH_NOT_PUBLIC_LIVE',
      'لا يمكن التحكم في الحجز العام إلا لفرع PUBLIC_LIVE نشط',
      409,
    );
  }

  const branchId = Number(branch.BranchID);
  const actionType = args.bookingEnabled
    ? 'resume_public_booking'
    : 'pause_public_booking';

  let audited: { success: true; auditId: number; data: { bookingEnabled: boolean } };
  try {
    audited = await executeAuditedAction({
      actionType,
      user: args.user,
      entityType: 'QueueBookingSettings',
      entityId: branchId,
      reason,
      request: args.request,
      actionMethod: 'POST',
      endpointPath: '/api/admin/public-booking/booking-enabled',
      loadOldData: async (tx) => {
        const r = await new sql.Request(tx)
          .input('branchId', sql.Int, branchId)
          .input('branchCode', sql.NVarChar(32), branchCode)
          .query(`
            SELECT TOP 1
              @branchId AS branchId,
              @branchCode AS branchCode,
              CAST(ISNULL(BookingEnabled, 0) AS BIT) AS bookingEnabled
            FROM dbo.QueueBookingSettings
            WHERE BranchID = @branchId
          `);
        const row = r.recordset[0] as Record<string, unknown> | undefined;
        return {
          branchId,
          branchCode,
          bookingEnabled: row ? isTruthyBit(row.bookingEnabled) : false,
          publicBookingEnabled: isTruthyBit(branch.PublicBookingEnabled),
          lifecycleStatus: String(branch.LifecycleStatus),
        };
      },
      execute: async (tx) => {
        const existing = await new sql.Request(tx)
          .input('branchId', sql.Int, branchId)
          .query(
            `SELECT TOP 1 SettingID FROM dbo.QueueBookingSettings WHERE BranchID = @branchId`,
          );
        if (!existing.recordset.length) {
          await new sql.Request(tx)
            .input('branchId', sql.Int, branchId)
            .query(`
              INSERT INTO dbo.QueueBookingSettings (
                BranchID, SalonName, Timezone, Currency, BookingEnabled,
                AllowSpecificBarber, AllowNearestBarber, DefaultMode,
                SlotIntervalMinutes, MinNoticeMinutes, MaxBookingDaysAhead,
                DefaultServiceDurationMinutes
              ) VALUES (
                @branchId, N'Cut Salon', N'Africa/Cairo', N'EGP', 1,
                1, 1, N'nearest', 15, 30, 14, 30
              )
            `);
        }

        await new sql.Request(tx)
          .input('branchId', sql.Int, branchId)
          .input('enabled', sql.Bit, args.bookingEnabled ? 1 : 0)
          .query(`
            UPDATE dbo.QueueBookingSettings
            SET BookingEnabled = @enabled, UpdatedAt = GETDATE()
            WHERE BranchID = @branchId
          `);

        // Never touch PublicBookingEnabled / LifecycleStatus here.
        return { bookingEnabled: args.bookingEnabled };
      },
      loadNewData: async (tx) => {
        const r = await new sql.Request(tx)
          .input('branchId', sql.Int, branchId)
          .query(`
            SELECT TOP 1 CAST(ISNULL(BookingEnabled, 0) AS BIT) AS bookingEnabled
            FROM dbo.QueueBookingSettings
            WHERE BranchID = @branchId
          `);
        return {
          branchId,
          branchCode,
          bookingEnabled: isTruthyBit(r.recordset[0]?.bookingEnabled),
          publicBookingEnabled: isTruthyBit(branch.PublicBookingEnabled),
          lifecycleStatus: String(branch.LifecycleStatus),
        };
      },
    });
  } catch (err) {
    if (isAuditedActionError(err)) {
      throw new PublicBookingOpsError(
        'AUDIT_ACTION_FAILED',
        err.message || 'فشل تنفيذ الإجراء',
        err.statusCode || 500,
      );
    }
    throw err;
  }

  invalidatePublicSettingsCache(branchId);
  invalidatePublicBookingBranchContextCache(branchCode);

  return {
    branchCode,
    bookingEnabled: args.bookingEnabled,
    auditId: audited.auditId,
  };
}

export class PublicBookingOpsError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = 'PublicBookingOpsError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
