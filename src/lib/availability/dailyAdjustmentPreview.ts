/**
 * Daily adjustment conflict preview — Phase D.
 * Simulates applyDailyAdjustments and lists overlapping bookings/queue.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { resolveEmployeeDayPlan } from '@/lib/availability/resolveEmployeeDayPlan';
import type { DailyAdjustmentType } from '@/lib/availability/dailyAdjustments';

export type DailyAdjustmentPreviewResult = {
  finalWindows: Array<{ start: string; end: string; endDayOffset: 0 | 1 }>;
  isWorking: boolean;
  denyReasonCode: string | null;
  affectedBookings: Array<{
    bookingId: number;
    bookingCode: string;
    startTime: string;
    endTime: string;
    status: string;
  }>;
  affectedQueueTickets: Array<{
    ticketId: number;
    ticketCode: string;
    status: string;
  }>;
  inService: boolean;
};

export async function previewDailyAdjustmentMutation(args: {
  branchId: number;
  empId: number;
  businessDate: string;
  adjustmentType: DailyAdjustmentType;
  windows?: Array<{ start: string; end: string; endDayOffset?: 0 | 1 }>;
}): Promise<DailyAdjustmentPreviewResult> {
  // Resolve current plan first for baseline; then we approximate post-mutation
  // by applying a dry-run through create path without persist — use resolve after
  // synthesizing adjustment list via apply path in resolveEmployeeDayPlan inputs.
  // Practical approach: load overlapping bookings against proposed windows / close.
  const db = await getPool();
  const plan = await resolveEmployeeDayPlan({
    empId: args.empId,
    businessDate: args.businessDate,
    branchId: args.branchId,
    source: 'operations',
  });

  const bookings = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('date', sql.Date, args.businessDate)
    .query(`
      SELECT BookingID, BookingCode,
        CONVERT(varchar(5), StartTime, 108) AS StartTime,
        CONVERT(varchar(5), EndTime, 108) AS EndTime,
        Status
      FROM dbo.Bookings
      WHERE AssignedEmpID = @empId
        AND BranchID = @branchId
        AND BookingDate = @date
        AND Status NOT IN (N'cancelled', N'completed', N'converted', N'no_show')
      ORDER BY StartTime
    `);

  const queue = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('date', sql.Date, args.businessDate)
    .query(`
      SELECT TOP 50 TicketID, TicketCode, Status
      FROM dbo.QueueTickets
      WHERE AssignedEmpID = @empId
        AND BranchID = @branchId
        AND CAST(CreatedAt AS date) = @date
        AND Status IN (N'waiting', N'called', N'in_service')
      ORDER BY TicketID DESC
    `).catch(() => ({ recordset: [] as Array<Record<string, unknown>> }));

  const inService = queue.recordset.some(
    (t: Record<string, unknown>) => String(t.Status) === 'in_service',
  );

  let finalWindows = plan.effectiveWindows.map((w) => ({
    start: w.start,
    end: w.end,
    endDayOffset: (w.endDayOffset ?? 0) as 0 | 1,
  }));
  let isWorking = plan.isWorking;
  let denyReasonCode = plan.denyReasonCode;

  if (args.adjustmentType === 'CLOSE_DAY') {
    finalWindows = [];
    isWorking = false;
    denyReasonCode = 'DAY_CLOSED_BY_ADJUSTMENT';
  } else if (args.adjustmentType === 'REPLACE_WINDOWS' && args.windows?.length) {
    finalWindows = args.windows.map((w) => ({
      start: w.start,
      end: w.end,
      endDayOffset: (w.endDayOffset ?? 0) as 0 | 1,
    }));
    isWorking = true;
    denyReasonCode = null;
  } else if (args.adjustmentType === 'ADD_WINDOW' && args.windows?.length) {
    finalWindows = [
      ...finalWindows,
      ...args.windows.map((w) => ({
        start: w.start,
        end: w.end,
        endDayOffset: (w.endDayOffset ?? 0) as 0 | 1,
      })),
    ];
    isWorking = true;
  }

  // Bookings outside final windows are affected (for CLOSE / REPLACE / BLOCK)
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const inAnyWindow = (start: string, end: string) => {
    if (!finalWindows.length) return false;
    const s = toMin(start);
    const e = toMin(end);
    return finalWindows.some((w) => {
      const ws = toMin(w.start);
      const we = toMin(w.end) + (w.endDayOffset === 1 ? 24 * 60 : 0);
      return s >= ws && e <= we;
    });
  };

  const affectedBookings = bookings.recordset
    .filter((b: Record<string, unknown>) => {
      if (args.adjustmentType === 'BLOCK_WINDOW' && args.windows?.[0]) {
        const bs = toMin(String(b.StartTime));
        const be = toMin(String(b.EndTime));
        const ws = toMin(args.windows[0].start);
        const we = toMin(args.windows[0].end);
        return bs < we && be > ws;
      }
      return !inAnyWindow(String(b.StartTime), String(b.EndTime));
    })
    .map((b: Record<string, unknown>) => ({
      bookingId: Number(b.BookingID),
      bookingCode: String(b.BookingCode ?? ''),
      startTime: String(b.StartTime ?? '').slice(0, 5),
      endTime: String(b.EndTime ?? '').slice(0, 5),
      status: String(b.Status ?? ''),
    }));

  return {
    finalWindows,
    isWorking,
    denyReasonCode,
    affectedBookings,
    affectedQueueTickets: queue.recordset.map((t: Record<string, unknown>) => ({
      ticketId: Number(t.TicketID),
      ticketCode: String(t.TicketCode ?? ''),
      status: String(t.Status ?? ''),
    })),
    inService,
  };
}

/** Reject BLOCK/break when overlapping bookings exist (no silent force). */
export async function assertBlockDoesNotOverlapBookings(args: {
  branchId: number;
  empId: number;
  businessDate: string;
  start: string;
  end: string;
}): Promise<void> {
  const preview = await previewDailyAdjustmentMutation({
    branchId: args.branchId,
    empId: args.empId,
    businessDate: args.businessDate,
    adjustmentType: 'BLOCK_WINDOW',
    windows: [{ start: args.start, end: args.end, endDayOffset: 0 }],
  });
  if (preview.affectedBookings.length > 0) {
    const err = new Error('BLOCK_OVERLAPS_BOOKING');
    (err as Error & { code: string; bookings: unknown }).code = 'BLOCK_OVERLAPS_BOOKING';
    (err as Error & { bookings: unknown }).bookings = preview.affectedBookings;
    throw err;
  }
}
