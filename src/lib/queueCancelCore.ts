import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { QueuePortHooks } from '@/apps/queue/internal/queuePortAdapter';
import {
  bridgeQueuePublishCancelledEvent,
  type QueuePortBridgeContext,
} from '@/lib/queue/queuePortLegacyBridge';

export interface CancelQueueTicketInput {
  ticketId: number;
  reason?: string;
  cancelBooking?: boolean;
  userId?: number;
  sessionBranchId: number;
  queuePortHooks?: QueuePortHooks;
  useExtractedEventDelivery?: boolean;
}

export interface CancelQueueTicketResult {
  ok: true;
  message: string;
  queueTicketId: number;
  ticketCode: string;
  status: string;
  bookingCancelled: boolean;
}

export class CancelQueueTicketError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export async function cancelQueueTicketCore(
  input: CancelQueueTicketInput,
): Promise<CancelQueueTicketResult> {
  const {
    ticketId,
    reason,
    cancelBooking = false,
    userId = 0,
    sessionBranchId,
    queuePortHooks,
    useExtractedEventDelivery,
  } = input;

  const db = await getPool();
  const transaction = new sql.Transaction(db);

  const checkRes = await db
    .request()
    .input('ticketId', sql.Int, ticketId)
    .query(`
      SELECT
        QueueTicketID,
        TicketCode,
        Status,
        BookingID,
        EmpID,
        ClientID,
        BranchID
      FROM dbo.QueueTickets
      WHERE QueueTicketID = @ticketId
    `);

  if (checkRes.recordset.length === 0) {
    throw new CancelQueueTicketError(404, 'الدور غير موجود');
  }

  const ticket = checkRes.recordset[0];
  const finalStatuses = ['cancelled', 'done', 'completed', 'skipped', 'no_show'];
  if (finalStatuses.includes(String(ticket.Status ?? '').toLowerCase())) {
    return {
      ok: true,
      message: 'الدور في حالة نهائية بالفعل',
      queueTicketId: ticketId,
      ticketCode: ticket.TicketCode,
      status: ticket.Status,
      bookingCancelled: false,
    };
  }

  if (String(ticket.Status ?? '').toLowerCase() === 'in_service') {
    throw new CancelQueueTicketError(
      409,
      'لا يمكن إلغاء دور قيد الخدمة - انهِ الخدمة أولاً',
    );
  }

  await transaction.begin();

  try {
    await transaction
      .request()
      .input('ticketId', sql.Int, ticketId)
      .query(`
        UPDATE dbo.QueueTickets
        SET Status = 'cancelled',
            CancelledAt = GETDATE()
        WHERE QueueTicketID = @ticketId
      `);

    const ctx: QueuePortBridgeContext = { queuePortHooks };
    if (useExtractedEventDelivery) {
      await bridgeQueuePublishCancelledEvent(ctx, transaction, {
        queueTicketId: ticketId,
        ticketCode: String(ticket.TicketCode),
      });
    }

    let bookingCancelled = false;
    let bookingDateYmd: string | null = null;
    if (cancelBooking && ticket.BookingID) {
      try {
        const bk = await transaction
          .request()
          .input('bookingId', sql.Int, ticket.BookingID)
          .query(`
            SELECT BookingDate, AssignedEmpID
            FROM dbo.Bookings
            WHERE BookingID = @bookingId
          `);
        const row = bk.recordset[0] as
          | { BookingDate: Date | string; AssignedEmpID: number | null }
          | undefined;
        if (row?.BookingDate instanceof Date) {
          bookingDateYmd = row.BookingDate.toISOString().slice(0, 10);
        } else if (row?.BookingDate) {
          bookingDateYmd = String(row.BookingDate).slice(0, 10);
        }

        await transaction
          .request()
          .input('bookingId', sql.Int, ticket.BookingID)
          .input(
            'reason',
            sql.NVarChar,
            reason ? `Queue cancelled: ${reason}` : 'Queue ticket cancelled',
          )
          .query(`
            UPDATE dbo.Bookings
            SET Status = 'cancelled',
                CancelledAt = GETDATE(),
                CancelReason = @reason
            WHERE BookingID = @bookingId
              AND Status NOT IN ('completed', 'cancelled', 'no_show')
          `);
        bookingCancelled = true;
      } catch (bookingErr) {
        console.warn('[queueCancelCore] Failed to cancel related booking:', bookingErr);
      }
    }

    await transaction.commit();

    try {
      const { AvailabilityMutationNotifier } = await import(
        '@/lib/booking/AvailabilityMutationNotifier'
      );
      const { getCairoBusinessDate } = await import('@/lib/businessDate');
      const queueDate = getCairoBusinessDate();
      if (ticket.EmpID) {
        await AvailabilityMutationNotifier.queueOccupancyChanged({
          employeeId: Number(ticket.EmpID),
          businessDate: queueDate,
          branchId: ticket.BranchID != null ? Number(ticket.BranchID) : sessionBranchId,
          reason: 'ops_queue_cancel',
        });
      }
      if (bookingCancelled && ticket.EmpID && bookingDateYmd) {
        await AvailabilityMutationNotifier.bookingOccupancyChanged({
          employeeId: Number(ticket.EmpID),
          businessDate: bookingDateYmd,
          branchId: ticket.BranchID != null ? Number(ticket.BranchID) : sessionBranchId,
          reason: 'ops_queue_cancel_booking',
        });
      }
    } catch {
      /* best-effort */
    }

    return {
      ok: true,
      message: 'تم إلغاء الدور بنجاح',
      queueTicketId: ticketId,
      ticketCode: ticket.TicketCode,
      status: 'cancelled',
      bookingCancelled,
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
