/**
 * Affected bookings resolution — list, resolve, follow-up, WhatsApp status.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { logBookingAvailabilityMetric } from '@/lib/availability/bookingAvailabilityMetrics';

export const BOOKING_ACTION_REQUIRED = 'ACTION_REQUIRED' as const;
export const BOOKING_AT_RISK = 'AT_RISK' as const;

export type AffectedResolutionStatus =
  | 'pending'
  | 'suggested'
  | 'move_confirmed'
  | 'moved'
  | 'cancelled'
  | 'unresolved'
  | 'resolved'
  | 'left_pending';

export type AffectedBookingRow = {
  actionId: number;
  bookingId: number;
  bookingCode: string;
  empId: number;
  empName: string | null;
  branchId: number;
  branchName: string | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: string;
  reasonCode: string;
  sourceEvent: string;
  sourceLabelAr: string;
  resolutionStatus: string;
  followUpStatus: string;
  customerName: string | null;
  /** Only when includePhone=true */
  customerPhone: string | null;
  servicesSummary: string | null;
  whatsappStatus: string | null;
  whatsappLastError: string | null;
  whatsappUpdatedAt: string | null;
  createdAt: string | null;
};

function sourceLabelAr(sourceEvent: string, reasonCode: string): string {
  const s = sourceEvent.toLowerCase();
  if (s.includes('auto_absence') || reasonCode === 'AT_RISK' || reasonCode === 'EMPLOYEE_ABSENT') {
    return 'غياب الموظف';
  }
  if (s.includes('early') || s.includes('early_leave')) return 'انصراف مبكر';
  if (s.includes('close_remaining') || s.includes('close_rest')) return 'إغلاق باقي اليوم';
  if (s.includes('close_day') || reasonCode === 'DAY_CLOSED_BY_ADJUSTMENT') return 'إغلاق اليوم';
  if (s.includes('branch_clos')) return 'إغلاق الفرع';
  if (s.includes('replace') || s.includes('schedule')) return 'استبدال الجدول';
  if (s.includes('transfer')) return 'نقل موظف';
  return 'تعديل توافر';
}

let ensured = false;

export async function ensureAffectedBookingTable(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF OBJECT_ID(N'dbo.TblBookingActionRequired', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblBookingActionRequired (
        ActionID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        BookingID INT NOT NULL,
        BranchID INT NOT NULL,
        EmpID INT NOT NULL,
        BusinessDate DATE NOT NULL,
        ReasonCode NVARCHAR(64) NOT NULL,
        SourceEvent NVARCHAR(80) NOT NULL,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_TblBookingAR_Status DEFAULT (N'pending'),
        SuggestedEmpID INT NULL,
        SuggestedStartAt DATETIME2 NULL,
        FollowUpStatus NVARCHAR(32) NOT NULL CONSTRAINT DF_TblBookingAR_Follow DEFAULT (N'not_required'),
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TblBookingAR_Created DEFAULT (SYSUTCDATETIME()),
        ResolvedAt DATETIME2 NULL,
        ResolvedByUserID INT NULL,
        CONSTRAINT UQ_TblBookingAR_Booking_Source UNIQUE (BookingID, SourceEvent)
      );
      CREATE INDEX IX_TblBookingAR_Pending
        ON dbo.TblBookingActionRequired (BranchID, BusinessDate, Status);
    END

    IF COL_LENGTH(N'dbo.Bookings', N'ActionRequired') IS NULL
    BEGIN
      ALTER TABLE dbo.Bookings ADD ActionRequired BIT NOT NULL
        CONSTRAINT DF_Bookings_ActionRequired DEFAULT (0);
    END
    IF COL_LENGTH(N'dbo.Bookings', N'AtRiskReason') IS NULL
    BEGIN
      ALTER TABLE dbo.Bookings ADD AtRiskReason NVARCHAR(64) NULL;
    END
  `);
  ensured = true;
}

export async function markBookingsActionRequired(args: {
  bookingIds: number[];
  reasonCode: string;
  sourceEvent: string;
  branchId: number;
  empId: number;
  businessDate: string;
}): Promise<number> {
  if (!args.bookingIds.length) return 0;
  await ensureAffectedBookingTable();
  const db = await getPool();
  let marked = 0;
  for (const bookingId of args.bookingIds) {
    await db
      .request()
      .input('id', sql.Int, bookingId)
      .input('reason', sql.NVarChar(64), args.reasonCode)
      .query(`
        UPDATE dbo.Bookings
        SET ActionRequired = 1,
            AtRiskReason = @reason,
            UpdatedAt = GETDATE()
        WHERE BookingID = @id
          AND Status NOT IN (N'cancelled', N'completed', N'converted', N'no_show')
      `);

    await db
      .request()
      .input('bookingId', sql.Int, bookingId)
      .input('branchId', sql.Int, args.branchId)
      .input('empId', sql.Int, args.empId)
      .input('date', sql.Date, args.businessDate)
      .input('reason', sql.NVarChar(64), args.reasonCode)
      .input('source', sql.NVarChar(80), args.sourceEvent)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.TblBookingActionRequired
          WHERE BookingID = @bookingId AND SourceEvent = @source
            AND Status IN (N'pending', N'suggested', N'unresolved', N'left_pending')
        )
          INSERT INTO dbo.TblBookingActionRequired (
            BookingID, BranchID, EmpID, BusinessDate, ReasonCode, SourceEvent, Status
          )
          VALUES (@bookingId, @branchId, @empId, @date, @reason, @source, N'pending');
      `);
    marked += 1;
  }

  logBookingAvailabilityMetric({
    event: 'affected_bookings_marked',
    reasonCode: args.reasonCode,
    branchId: args.branchId,
    empId: args.empId,
    businessDate: args.businessDate,
    affectedCount: marked,
    extra: { sourceEvent: args.sourceEvent },
  });
  return marked;
}

export async function listAffectedBookings(args: {
  branchId?: number | null;
  businessDate?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  empId?: number | null;
  reasonCode?: string | null;
  unresolvedOnly?: boolean;
  whatsappFailed?: boolean;
  pendingCall?: boolean;
  includePhone?: boolean;
}): Promise<AffectedBookingRow[]> {
  await ensureAffectedBookingTable();
  const db = await getPool();
  const unresolvedOnly = args.unresolvedOnly !== false;
  const r = await db
    .request()
    .input('branchId', sql.Int, args.branchId ?? null)
    .input('date', sql.Date, args.businessDate ?? null)
    .input('dateFrom', sql.Date, args.dateFrom ?? null)
    .input('dateTo', sql.Date, args.dateTo ?? null)
    .input('empId', sql.Int, args.empId ?? null)
    .input('reason', sql.NVarChar(64), args.reasonCode ?? null)
    .input('unresolvedOnly', sql.Bit, unresolvedOnly ? 1 : 0)
    .input('waFailed', sql.Bit, args.whatsappFailed ? 1 : 0)
    .input('pendingCall', sql.Bit, args.pendingCall ? 1 : 0)
    .query(`
      SELECT
        ar.ActionID, ar.BookingID, b.BookingCode, ar.EmpID, ar.BranchID,
        CONVERT(varchar(10), ar.BusinessDate, 23) AS BusinessDate,
        CONVERT(varchar(5), b.StartTime, 108) AS StartTime,
        CONVERT(varchar(5), b.EndTime, 108) AS EndTime,
        b.Status AS BookingStatus, ar.ReasonCode, ar.SourceEvent, ar.Status AS ResolutionStatus,
        ar.FollowUpStatus,
        CONVERT(varchar(33), ar.CreatedAt, 127) AS CreatedAt,
        e.EmpName, br.BranchName, c.[Name] AS ClientName, c.Mobile AS ClientMobile,
        (
          SELECT STRING_AGG(p.ProName, N'، ')
          FROM dbo.BookingServices bs
          LEFT JOIN dbo.TblPro p ON p.ProID = bs.ProID
          WHERE bs.BookingID = b.BookingID
        ) AS ServicesSummary,
        wa.Status AS WhatsAppStatus,
        wa.LastError AS WhatsAppLastError,
        CONVERT(varchar(33), wa.UpdatedAt, 127) AS WhatsAppUpdatedAt
      FROM dbo.TblBookingActionRequired ar
      INNER JOIN dbo.Bookings b ON b.BookingID = ar.BookingID
      LEFT JOIN dbo.TblEmp e ON e.EmpID = ar.EmpID
      LEFT JOIN dbo.TblBranch br ON br.BranchID = ar.BranchID
      LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      OUTER APPLY (
        SELECT TOP 1 n.Status, n.LastError, n.UpdatedAt
        FROM dbo.TblBookingNotifyRequest n
        WHERE n.BookingID = ar.BookingID
        ORDER BY n.NotifyID DESC
      ) wa
      WHERE (@branchId IS NULL OR ar.BranchID = @branchId)
        AND (@date IS NULL OR ar.BusinessDate = @date)
        AND (@dateFrom IS NULL OR ar.BusinessDate >= @dateFrom)
        AND (@dateTo IS NULL OR ar.BusinessDate <= @dateTo)
        AND (@empId IS NULL OR ar.EmpID = @empId)
        AND (@reason IS NULL OR ar.ReasonCode = @reason)
        AND (
          @unresolvedOnly = 0
          OR ar.Status IN (N'pending', N'suggested', N'unresolved', N'left_pending')
        )
        AND (@waFailed = 0 OR wa.Status = N'failed')
        AND (@pendingCall = 0 OR ar.FollowUpStatus = N'pending_call')
      ORDER BY ar.BusinessDate, b.StartTime, ar.BookingID
    `);

  return r.recordset.map((row: Record<string, unknown>) => ({
    actionId: Number(row.ActionID),
    bookingId: Number(row.BookingID),
    bookingCode: String(row.BookingCode ?? ''),
    empId: Number(row.EmpID),
    empName: row.EmpName != null ? String(row.EmpName) : null,
    branchId: Number(row.BranchID),
    branchName: row.BranchName != null ? String(row.BranchName) : null,
    bookingDate: String(row.BusinessDate).slice(0, 10),
    startTime: String(row.StartTime ?? '').slice(0, 5),
    endTime: String(row.EndTime ?? '').slice(0, 5),
    status: String(row.BookingStatus ?? ''),
    reasonCode: String(row.ReasonCode ?? ''),
    sourceEvent: String(row.SourceEvent ?? ''),
    sourceLabelAr: sourceLabelAr(String(row.SourceEvent ?? ''), String(row.ReasonCode ?? '')),
    resolutionStatus: String(row.ResolutionStatus ?? 'pending'),
    followUpStatus: String(row.FollowUpStatus ?? 'not_required'),
    customerName: row.ClientName != null ? String(row.ClientName) : null,
    customerPhone: args.includePhone && row.ClientMobile != null ? String(row.ClientMobile) : null,
    servicesSummary: row.ServicesSummary != null ? String(row.ServicesSummary) : null,
    whatsappStatus: row.WhatsAppStatus != null ? String(row.WhatsAppStatus) : null,
    whatsappLastError: row.WhatsAppLastError != null ? String(row.WhatsAppLastError).slice(0, 200) : null,
    whatsappUpdatedAt: row.WhatsAppUpdatedAt != null ? String(row.WhatsAppUpdatedAt) : null,
    createdAt: row.CreatedAt != null ? String(row.CreatedAt) : null,
  }));
}

/** @deprecated Prefer listAffectedBookings */
export async function listPendingAffectedBookings(args: {
  branchId: number;
  businessDate: string;
}): Promise<AffectedBookingRow[]> {
  return listAffectedBookings({
    branchId: args.branchId,
    businessDate: args.businessDate,
    unresolvedOnly: true,
    includePhone: false,
  });
}

export async function resolveAffectedBookingAction(args: {
  bookingId: number;
  sourceEvent?: string;
  actorUserId: number;
  status: AffectedResolutionStatus;
}): Promise<void> {
  await ensureAffectedBookingTable();
  const db = await getPool();
  const status = args.status;
  await db
    .request()
    .input('bookingId', sql.Int, args.bookingId)
    .input('source', sql.NVarChar(80), args.sourceEvent ?? null)
    .input('status', sql.NVarChar(32), status)
    .input('actor', sql.Int, args.actorUserId)
    .query(`
      UPDATE dbo.TblBookingActionRequired
      SET Status = @status,
          ResolvedAt = CASE
            WHEN @status IN (N'resolved', N'moved', N'cancelled') THEN SYSUTCDATETIME()
            ELSE ResolvedAt
          END,
          ResolvedByUserID = CASE
            WHEN @status IN (N'resolved', N'moved', N'cancelled') THEN @actor
            ELSE ResolvedByUserID
          END
      WHERE BookingID = @bookingId
        AND (@source IS NULL OR SourceEvent = @source)
        AND Status IN (N'pending', N'suggested', N'unresolved', N'left_pending', N'move_confirmed')
    `);
  if (status === 'resolved' || status === 'cancelled' || status === 'moved') {
    await db
      .request()
      .input('id', sql.Int, args.bookingId)
      .query(`
        UPDATE dbo.Bookings
        SET ActionRequired = 0, AtRiskReason = NULL, UpdatedAt = GETDATE()
        WHERE BookingID = @id
      `);
  }
}

export async function updateBookingFollowUpStatus(args: {
  bookingId: number;
  followUpStatus: 'not_required' | 'pending_call' | 'called' | 'no_answer' | 'resolved';
}): Promise<void> {
  await ensureAffectedBookingTable();
  const db = await getPool();
  await db
    .request()
    .input('bookingId', sql.Int, args.bookingId)
    .input('fu', sql.NVarChar(32), args.followUpStatus)
    .query(`
      UPDATE dbo.TblBookingActionRequired
      SET FollowUpStatus = @fu
      WHERE BookingID = @bookingId
        AND Status IN (N'pending', N'suggested', N'unresolved', N'left_pending', N'move_confirmed')
    `);
}
