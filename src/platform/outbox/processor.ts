import 'server-only';

import { getPool, sql } from '@/lib/db';
import { loadBookingCustomerContact } from '@/lib/booking/bookingCustomerContact';
import { sendWhatsAppMessage } from '@/lib/integrations/whatsapp';
import { composeMessage } from '@/modules/messaging/application/composeMessage';
import {
  BOOKING_CANCELLATION_TEMPLATE_KEY,
  BOOKING_CONFIRMATION_TEMPLATE_KEY,
} from '@/modules/messaging/templates/catalog';

type PlatformOutboxRow = {
  Id: number;
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventType: string;
  Payload: string;
  IdempotencyKey: string | null;
  OccurredAt: Date;
  Status: 'pending' | 'delivering' | 'delivered' | 'dead';
  Attempts: number;
  CorrelationId: string | null;
};

export type ProcessPlatformOutboxResult = {
  claimed: number;
  delivered: number;
  retried: number;
  dead: number;
};

const MAX_ATTEMPTS = 5;

async function claimBatch(batchSize: number): Promise<PlatformOutboxRow[]> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const result = await new sql.Request(tx)
      .input('batchSize', sql.Int, Math.max(1, Math.min(50, Math.floor(batchSize))))
      .query<PlatformOutboxRow>(`
        ;WITH claim AS (
          SELECT TOP (@batchSize) Id
          FROM dbo.PlatformOutbox WITH (UPDLOCK, READPAST, ROWLOCK)
          WHERE Status = N'pending'
            AND Attempts < 5
            AND EventType IN (
              N'booking.created',
              N'booking.cancelled',
              N'booking.rescheduled'
            )
          ORDER BY OccurredAt ASC, Id ASC
        )
        UPDATE p
        SET Status = N'delivering',
            Attempts = Attempts + 1
        OUTPUT
          INSERTED.Id,
          INSERTED.TenantId,
          INSERTED.AggregateType,
          INSERTED.AggregateId,
          INSERTED.EventType,
          INSERTED.Payload,
          INSERTED.IdempotencyKey,
          INSERTED.OccurredAt,
          INSERTED.Status,
          INSERTED.Attempts,
          INSERTED.CorrelationId
        FROM dbo.PlatformOutbox p
        INNER JOIN claim c ON c.Id = p.Id;
      `);
    await tx.commit();
    return result.recordset;
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // ignore rollback failure
    }
    throw error;
  }
}

async function markDelivered(id: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`
      UPDATE dbo.PlatformOutbox
      SET Status = N'delivered'
      WHERE Id = @id AND Status = N'delivering';
    `);
}

async function markRetryOrDead(row: PlatformOutboxRow): Promise<'retried' | 'dead'> {
  const dead = row.Attempts >= MAX_ATTEMPTS;
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, row.Id)
    .input('status', sql.NVarChar(20), dead ? 'dead' : 'pending')
    .query(`
      UPDATE dbo.PlatformOutbox
      SET Status = @status
      WHERE Id = @id AND Status = N'delivering';
    `);
  return dead ? 'dead' : 'retried';
}

export async function recoverPlatformOutboxDelivering(): Promise<number> {
  const pool = await getPool();
  const result = await pool.request().query(`
    UPDATE dbo.PlatformOutbox
    SET Status = N'pending'
    WHERE Status = N'delivering'
      AND EventType IN (
        N'booking.created',
        N'booking.cancelled',
        N'booking.rescheduled'
      );
    SELECT @@ROWCOUNT AS Recovered;
  `);
  return Number(result.recordset[0]?.Recovered ?? 0);
}

function bookingIdFromRow(row: PlatformOutboxRow): number {
  const id = Number(row.AggregateId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('PLATFORM_OUTBOX_INVALID_BOOKING_ID');
  }
  return id;
}

function servicesFromSummary(summary: string | null): string {
  return summary?.trim() || 'الخدمة المحجوزة';
}

async function deliverBookingEvent(row: PlatformOutboxRow): Promise<void> {
  const bookingId = bookingIdFromRow(row);
  const contact = await loadBookingCustomerContact(bookingId);
  if (!contact) {
    throw new Error('BOOKING_NOT_FOUND');
  }
  if (!contact.phone) {
    throw new Error('BOOKING_CUSTOMER_PHONE_MISSING');
  }

  const isCancelled = row.EventType === 'booking.cancelled';
  const templateKey = isCancelled
    ? BOOKING_CANCELLATION_TEMPLATE_KEY
    : BOOKING_CONFIRMATION_TEMPLATE_KEY;

  const bookingRef = contact.bookingCode ?? `BK-${bookingId}`;
  const composed = await composeMessage({
    templateKey,
    variables: {
      customerName: contact.customerName?.trim() || 'عميلنا',
      bookingDate: contact.bookingDate ?? '',
      bookingTime: contact.startTime ?? '',
      date: contact.bookingDate ?? '',
      time: contact.startTime ?? '',
      service: servicesFromSummary(contact.servicesSummary),
      services: servicesFromSummary(contact.servicesSummary),
      barberName: contact.empName ?? '',
      branchName: contact.branchName ?? '',
      bookingId: bookingRef,
    },
    context: {
      channel: 'whatsapp',
      language: 'ar',
      ...(typeof contact.branchId === 'number'
        ? { branchId: contact.branchId }
        : {}),
    },
  });

  const result = await sendWhatsAppMessage({
    phone: contact.phone,
    message: composed.text,
    idempotencyKey:
      row.IdempotencyKey?.trim() || `platform-outbox:${row.Id}`,
    metadata: {
      source: row.EventType,
      platformOutboxId: row.Id,
      tenantId: row.TenantId,
      aggregateType: row.AggregateType,
      aggregateId: row.AggregateId,
      bookingId,
      bookingCode: bookingRef,
      templateKey,
      templateSource: composed.source,
    },
  });

  if (!result.sent) {
    throw new Error(
      'error' in result && result.error
        ? result.error
        : `WHATSAPP_SEND_FAILED:${result.reason}`,
    );
  }
}

async function deliverRow(row: PlatformOutboxRow): Promise<void> {
  if (
    row.EventType === 'booking.created'
    || row.EventType === 'booking.cancelled'
    || row.EventType === 'booking.rescheduled'
  ) {
    await deliverBookingEvent(row);
    return;
  }
  throw new Error('PLATFORM_OUTBOX_EVENT_UNSUPPORTED');
}

export async function processPlatformOutboxTick(input?: {
  batchSize?: number;
}): Promise<ProcessPlatformOutboxResult> {
  const claimed = await claimBatch(input?.batchSize ?? 20);
  const summary: ProcessPlatformOutboxResult = {
    claimed: claimed.length,
    delivered: 0,
    retried: 0,
    dead: 0,
  };

  for (const row of claimed) {
    try {
      await deliverRow(row);
      await markDelivered(row.Id);
      summary.delivered += 1;
    } catch (error) {
      const outcome = await markRetryOrDead(row);
      summary[outcome] += 1;
      console.error('[platform-outbox] delivery failed', {
        id: row.Id,
        eventType: row.EventType,
        aggregateId: row.AggregateId,
        attempts: row.Attempts,
        outcome,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}
