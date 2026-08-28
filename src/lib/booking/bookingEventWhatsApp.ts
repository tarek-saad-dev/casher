/**
 * WhatsApp after move/cancel with idempotency — Phase I + final workflows.
 * Status lifecycle: queued → sending → sent | failed
 * Never mark sent until provider confirms. Missing phone = visible failure, not booking failure.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { scheduleBookingWhatsAppAfterCommit } from '@/lib/bookingPostCommitNotification';
import { scheduleBookingTeamGroupNotify } from '@/lib/bookingGroupWhatsAppNotify';
import { logBookingAvailabilityMetric } from '@/lib/availability/bookingAvailabilityMetrics';
import { loadBookingCustomerContact } from '@/lib/booking/bookingCustomerContact';
import { isUsableCustomerPhone } from '@/lib/publicBookingHelpers';

let ensured = false;

export async function ensureBookingNotifyIdempotencyTable(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF OBJECT_ID(N'dbo.TblBookingNotifyRequest', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblBookingNotifyRequest (
        NotifyID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        IdempotencyKey NVARCHAR(120) NOT NULL,
        BookingID INT NOT NULL,
        EventType NVARCHAR(40) NOT NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_TblBookingNotify_Status DEFAULT (N'queued'),
        RetryCount INT NOT NULL CONSTRAINT DF_TblBookingNotify_Retry DEFAULT (0),
        ProviderMessageId NVARCHAR(120) NULL,
        LastError NVARCHAR(400) NULL,
        QueuedAt DATETIME2 NULL,
        SendingAt DATETIME2 NULL,
        SentAt DATETIME2 NULL,
        FailedAt DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TblBookingNotify_Created DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2 NULL,
        CONSTRAINT UQ_TblBookingNotify_Key UNIQUE (IdempotencyKey)
      );
      CREATE INDEX IX_TblBookingNotify_Booking
        ON dbo.TblBookingNotifyRequest (BookingID, NotifyID DESC);
    END

    IF COL_LENGTH(N'dbo.TblBookingNotifyRequest', N'QueuedAt') IS NULL
      ALTER TABLE dbo.TblBookingNotifyRequest ADD QueuedAt DATETIME2 NULL;
    IF COL_LENGTH(N'dbo.TblBookingNotifyRequest', N'SendingAt') IS NULL
      ALTER TABLE dbo.TblBookingNotifyRequest ADD SendingAt DATETIME2 NULL;
    IF COL_LENGTH(N'dbo.TblBookingNotifyRequest', N'SentAt') IS NULL
      ALTER TABLE dbo.TblBookingNotifyRequest ADD SentAt DATETIME2 NULL;
    IF COL_LENGTH(N'dbo.TblBookingNotifyRequest', N'FailedAt') IS NULL
      ALTER TABLE dbo.TblBookingNotifyRequest ADD FailedAt DATETIME2 NULL;
  `);
  ensured = true;
}

export type BookingNotifyEventType = 'create' | 'move' | 'cancel';

export type BookingNotifyStatusRow = {
  notifyId: number;
  idempotencyKey: string;
  eventType: string;
  status: string;
  retryCount: number;
  lastError: string | null;
  providerMessageId: string | null;
  queuedAt: string | null;
  sendingAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  updatedAt: string | null;
};

function buildMoveServicesMessage(args: {
  bookingCode: string;
  branchName?: string | null;
  bookingDate: string;
  bookingTime: string;
  barberName?: string | null;
  servicesSummary?: string | null;
}): string[] {
  const parts = [
    `تم تعديل موعد حجزك ${args.bookingCode} بنجاح.`,
    args.branchName ? `الفرع: ${args.branchName}` : null,
    `الموعد الجديد: ${args.bookingDate} الساعة ${args.bookingTime}`,
    args.barberName ? `الموظف: ${args.barberName}` : null,
    args.servicesSummary ? `الخدمات: ${args.servicesSummary}` : null,
    'شكراً لثقتكم بنا.',
  ].filter(Boolean) as string[];
  return parts;
}

function buildCancelServicesMessage(args: {
  bookingCode: string;
  branchName?: string | null;
}): string[] {
  return [
    `تم إلغاء حجزك ${args.bookingCode}.`,
    args.branchName ? `الفرع: ${args.branchName}` : null,
    'للاستفسار يرجى التواصل مع الفرع.',
  ].filter(Boolean) as string[];
}

/**
 * Queue exactly one WhatsApp event for a booking version.
 * Missing/invalid phone → record failed row (visible), return scheduled:false.
 */
export async function scheduleBookingEventWhatsApp(args: {
  bookingId: number;
  bookingCode: string;
  eventType: BookingNotifyEventType;
  eventVersion: string | number;
  phone: string | null | undefined;
  customerName: string | null | undefined;
  bookingDate: string;
  bookingTime: string;
  barberName?: string | null;
  branchName?: string | null;
  branchId?: number | null;
  servicesSummary?: string | null;
  cancelled?: boolean;
}): Promise<{ scheduled: boolean; skippedReason?: string; idempotencyKey: string }> {
  await ensureBookingNotifyIdempotencyTable();
  const key = `wa:${args.eventType}:${args.bookingId}:${args.eventVersion}`;
  const db = await getPool();
  const phoneOk = isUsableCustomerPhone(args.phone);

  try {
    await db
      .request()
      .input('key', sql.NVarChar(120), key)
      .input('bookingId', sql.Int, args.bookingId)
      .input('eventType', sql.NVarChar(40), args.eventType)
      .query(`
        INSERT INTO dbo.TblBookingNotifyRequest (
          IdempotencyKey, BookingID, EventType, Status, QueuedAt, UpdatedAt
        )
        VALUES (@key, @bookingId, @eventType, N'queued', SYSUTCDATETIME(), SYSUTCDATETIME())
      `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UQ_TblBookingNotify|duplicate/i.test(msg)) {
      return { scheduled: false, skippedReason: 'duplicate', idempotencyKey: key };
    }
    throw err;
  }

  const name = args.customerName?.trim() || 'عميلنا';
  const groupEventKey =
    args.eventType === 'cancel'
      ? 'booking.cancelled'
      : args.eventType === 'move'
        ? 'booking.moved'
        : null;
  if (groupEventKey) {
    scheduleBookingTeamGroupNotify({
      eventKey: groupEventKey,
      bookingId: args.bookingId,
      customerName: name,
      bookingDate: args.bookingDate,
      bookingTime: args.bookingTime,
      barberName: args.barberName ?? undefined,
      services: args.servicesSummary
        ? args.servicesSummary.split(/[,،]/).map((s) => s.trim()).filter(Boolean)
        : undefined,
      branchName: args.branchName ?? undefined,
      branchId: args.branchId ?? undefined,
    });
  }

  if (!phoneOk) {
    const errMsg = !args.phone?.trim()
      ? 'MISSING_CUSTOMER_PHONE'
      : 'INVALID_CUSTOMER_PHONE';
    await markBookingNotifyResult({
      idempotencyKey: key,
      status: 'failed',
      error: errMsg,
    });
    logBookingAvailabilityMetric({
      event: 'whatsapp_notification_result',
      bookingId: args.bookingId,
      bookingCode: args.bookingCode,
      whatsappStatus: 'failed',
      extra: { eventType: args.eventType, reason: errMsg },
    });
    return { scheduled: false, skippedReason: 'no_phone', idempotencyKey: key };
  }

  const services =
    args.cancelled || args.eventType === 'cancel'
      ? buildCancelServicesMessage({
          bookingCode: args.bookingCode,
          branchName: args.branchName,
        })
      : args.eventType === 'move'
        ? buildMoveServicesMessage({
            bookingCode: args.bookingCode,
            branchName: args.branchName,
            bookingDate: args.bookingDate,
            bookingTime: args.bookingTime,
            barberName: args.barberName,
            servicesSummary: args.servicesSummary,
          })
        : undefined;

  await db
    .request()
    .input('key', sql.NVarChar(120), key)
    .query(`
      UPDATE dbo.TblBookingNotifyRequest
      SET Status = N'sending',
          SendingAt = SYSUTCDATETIME(),
          UpdatedAt = SYSUTCDATETIME()
      WHERE IdempotencyKey = @key
        AND Status = N'queued'
    `);

  scheduleBookingWhatsAppAfterCommit(
    {
      phone: String(args.phone),
      customerName: name,
      bookingId: args.bookingId,
      bookingDate: args.bookingDate,
      bookingTime: args.bookingTime,
      barberName: args.barberName ?? undefined,
      branchName: args.branchName ?? undefined,
      services,
    },
    {
      onResult: async (result) => {
        await markBookingNotifyResult({
          idempotencyKey: key,
          status: result.ok ? 'sent' : 'failed',
          providerMessageId: result.providerMessageId ?? null,
          error: result.error ?? null,
        });
      },
    },
  );

  logBookingAvailabilityMetric({
    event: 'whatsapp_notification_result',
    bookingId: args.bookingId,
    bookingCode: args.bookingCode,
    whatsappStatus: 'queued',
    extra: { eventType: args.eventType },
  });

  return { scheduled: true, idempotencyKey: key };
}

export async function markBookingNotifyResult(args: {
  idempotencyKey: string;
  status: 'sent' | 'failed';
  providerMessageId?: string | null;
  error?: string | null;
}): Promise<void> {
  await ensureBookingNotifyIdempotencyTable();
  const db = await getPool();
  await db
    .request()
    .input('key', sql.NVarChar(120), args.idempotencyKey)
    .input('status', sql.NVarChar(20), args.status)
    .input('providerId', sql.NVarChar(120), args.providerMessageId ?? null)
    .input('err', sql.NVarChar(400), (args.error ?? null)?.slice(0, 400) ?? null)
    .query(`
      UPDATE dbo.TblBookingNotifyRequest
      SET Status = @status,
          ProviderMessageId = ISNULL(@providerId, ProviderMessageId),
          LastError = CASE WHEN @status = N'failed' THEN @err ELSE LastError END,
          RetryCount = CASE WHEN @status = N'failed' THEN RetryCount + 1 ELSE RetryCount END,
          SentAt = CASE WHEN @status = N'sent' THEN SYSUTCDATETIME() ELSE SentAt END,
          FailedAt = CASE WHEN @status = N'failed' THEN SYSUTCDATETIME() ELSE FailedAt END,
          UpdatedAt = SYSUTCDATETIME()
      WHERE IdempotencyKey = @key
        AND Status IN (N'queued', N'sending', N'failed')
    `);
}

export async function getLatestBookingNotifyStatus(
  bookingId: number,
): Promise<BookingNotifyStatusRow | null> {
  await ensureBookingNotifyIdempotencyTable();
  const db = await getPool();
  const r = await db
    .request()
    .input('id', sql.Int, bookingId)
    .query(`
      SELECT TOP 1
        NotifyID, IdempotencyKey, EventType, Status, RetryCount,
        ProviderMessageId, LastError,
        CONVERT(varchar(33), QueuedAt, 127) AS QueuedAt,
        CONVERT(varchar(33), SendingAt, 127) AS SendingAt,
        CONVERT(varchar(33), SentAt, 127) AS SentAt,
        CONVERT(varchar(33), FailedAt, 127) AS FailedAt,
        CONVERT(varchar(33), UpdatedAt, 127) AS UpdatedAt
      FROM dbo.TblBookingNotifyRequest
      WHERE BookingID = @id
      ORDER BY NotifyID DESC
    `);
  const row = r.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    notifyId: Number(row.NotifyID),
    idempotencyKey: String(row.IdempotencyKey),
    eventType: String(row.EventType),
    status: String(row.Status),
    retryCount: Number(row.RetryCount ?? 0),
    lastError: row.LastError != null ? String(row.LastError).slice(0, 200) : null,
    providerMessageId: row.ProviderMessageId != null ? String(row.ProviderMessageId) : null,
    queuedAt: row.QueuedAt != null ? String(row.QueuedAt) : null,
    sendingAt: row.SendingAt != null ? String(row.SendingAt) : null,
    sentAt: row.SentAt != null ? String(row.SentAt) : null,
    failedAt: row.FailedAt != null ? String(row.FailedAt) : null,
    updatedAt: row.UpdatedAt != null ? String(row.UpdatedAt) : null,
  };
}

/**
 * Retry failed WhatsApp only. Preserves same idempotency key.
 * Concurrent retries: CAS Status failed → sending.
 */
export async function retryBookingEventWhatsApp(args: {
  bookingId: number;
  eventType?: BookingNotifyEventType;
}): Promise<{
  ok: boolean;
  code?: string;
  status?: string;
  error?: string;
}> {
  await ensureBookingNotifyIdempotencyTable();
  const db = await getPool();
  const eventType = args.eventType ?? null;
  const latest = await db
    .request()
    .input('id', sql.Int, args.bookingId)
    .input('etype', sql.NVarChar(40), eventType)
    .query(`
      SELECT TOP 1 NotifyID, IdempotencyKey, EventType, Status, RetryCount
      FROM dbo.TblBookingNotifyRequest
      WHERE BookingID = @id
        AND (@etype IS NULL OR EventType = @etype)
      ORDER BY NotifyID DESC
    `);
  const row = latest.recordset[0] as
    | { NotifyID: number; IdempotencyKey: string; EventType: string; Status: string }
    | undefined;
  if (!row) {
    return { ok: false, code: 'NOTIFY_NOT_FOUND', error: 'لا يوجد إشعار لإعادة المحاولة' };
  }
  if (row.Status === 'sent') {
    return { ok: false, code: 'ALREADY_SENT', error: 'تم الإرسال مسبقاً — لن يُعاد الإرسال' };
  }
  if (row.Status !== 'failed') {
    return {
      ok: false,
      code: 'NOT_FAILED',
      status: row.Status,
      error: 'إعادة المحاولة متاحة للإشعارات الفاشلة فقط',
    };
  }

  const claim = await db
    .request()
    .input('id', sql.BigInt, row.NotifyID)
    .query(`
      UPDATE dbo.TblBookingNotifyRequest
      SET Status = N'sending',
          SendingAt = SYSUTCDATETIME(),
          UpdatedAt = SYSUTCDATETIME(),
          LastError = NULL
      WHERE NotifyID = @id AND Status = N'failed';
      SELECT @@ROWCOUNT AS Claimed;
    `);
  if (Number(claim.recordset[0]?.Claimed ?? 0) !== 1) {
    return { ok: false, code: 'RETRY_IN_PROGRESS', error: 'إعادة محاولة جارية بالفعل' };
  }

  const contact = await loadBookingCustomerContact(args.bookingId);
  if (!contact?.phone) {
    await markBookingNotifyResult({
      idempotencyKey: row.IdempotencyKey,
      status: 'failed',
      error: 'MISSING_CUSTOMER_PHONE',
    });
    return { ok: false, code: 'MISSING_CUSTOMER_PHONE', error: 'رقم الهاتف غير متوفر' };
  }

  const isCancel = row.EventType === 'cancel';
  scheduleBookingWhatsAppAfterCommit(
    {
      phone: contact.phone,
      customerName: contact.customerName ?? 'عميلنا',
      bookingId: args.bookingId,
      bookingDate: contact.bookingDate ?? '',
      bookingTime: contact.startTime ?? '',
      barberName: contact.empName ?? undefined,
      branchName: contact.branchName ?? undefined,
      services: isCancel
        ? buildCancelServicesMessage({
            bookingCode: contact.bookingCode ?? `BK-${args.bookingId}`,
            branchName: contact.branchName,
          })
        : buildMoveServicesMessage({
            bookingCode: contact.bookingCode ?? `BK-${args.bookingId}`,
            branchName: contact.branchName,
            bookingDate: contact.bookingDate ?? '',
            bookingTime: contact.startTime ?? '',
            barberName: contact.empName,
            servicesSummary: contact.servicesSummary,
          }),
    },
    {
      onResult: async (result) => {
        await markBookingNotifyResult({
          idempotencyKey: row.IdempotencyKey,
          status: result.ok ? 'sent' : 'failed',
          providerMessageId: result.providerMessageId ?? null,
          error: result.error ?? null,
        });
      },
    },
  );

  return { ok: true, status: 'sending' };
}

/** Helper: schedule cancel WhatsApp after a committed cancellation. */
export async function scheduleCancelWhatsAppAfterCommit(bookingId: number): Promise<void> {
  try {
    const contact = await loadBookingCustomerContact(bookingId);
    if (!contact) return;
    const version = `cancel:${contact.bookingDate ?? ''}:${Date.now()}`;
    // Prefer stable version from CancelledAt if available
    const db = await getPool();
    const r = await db
      .request()
      .input('id', sql.Int, bookingId)
      .query(`
        SELECT CONVERT(varchar(33), ISNULL(PublicCancelledAtUtc, CancelledAt), 127) AS CancelledAt
        FROM dbo.Bookings WHERE BookingID = @id
      `);
    const cancelledAt = r.recordset[0]?.CancelledAt
      ? String(r.recordset[0].CancelledAt)
      : version;
    await scheduleBookingEventWhatsApp({
      bookingId,
      bookingCode: contact.bookingCode ?? `BK-${bookingId}`,
      eventType: 'cancel',
      eventVersion: cancelledAt,
      phone: contact.phone,
      customerName: contact.customerName,
      bookingDate: contact.bookingDate ?? '',
      bookingTime: contact.startTime ?? '',
      barberName: contact.empName,
      branchName: contact.branchName,
      servicesSummary: contact.servicesSummary,
      cancelled: true,
    });
  } catch {
    /* best-effort; cancel already committed */
  }
}
