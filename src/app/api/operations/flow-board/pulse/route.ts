/**
 * GET /api/operations/flow-board/pulse
 * Cheap fingerprint for ops live-refresh + new-booking alerts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { listUserValidBranchAccess } from '@/lib/branch/repository';
import { getPool, sql } from '@/lib/db';
import { getOperationsDayStateVersion } from '@/lib/hr/scheduleAvailabilityInvalidation';
import {
  buildOpsBoardPulseFingerprint,
  mergeOpsBoardPulse,
  nextCalendarDate,
  type OpsBoardPulseSnapshot,
} from '@/lib/operations/opsBoardPulse';

export const runtime = 'nodejs';

async function loadBranchPulse(
  branchId: number,
  dateStr: string,
): Promise<OpsBoardPulseSnapshot> {
  const db = await getPool();
  const nextDate = nextCalendarDate(dateStr);

  const [bookingRes, queueRes] = await Promise.all([
    db
      .request()
      .input('branchId', sql.Int, branchId)
      .input('d', sql.Date, dateStr)
      .input('dNext', sql.Date, nextDate)
      .query(`
        SELECT
          ISNULL(MAX(b.BookingID), 0) AS MaxBookingId,
          COUNT(*) AS BookingCount,
          CONVERT(varchar(30), MAX(b.UpdatedAt), 126) AS BookingUpdatedAt
        FROM [dbo].[Bookings] b
        WHERE b.BranchID = @branchId
          AND b.BookingDate IN (@d, @dNext)
          AND b.Status IN ('confirmed', 'arrived', 'in_progress', 'queued', 'in_service')
      `),
    db
      .request()
      .input('branchId', sql.Int, branchId)
      .input('d', sql.Date, dateStr)
      .input('dNext', sql.Date, nextDate)
      .query(`
        SELECT
          ISNULL(MAX(qt.QueueTicketID), 0) AS MaxQueueId,
          COUNT(*) AS QueueCount,
          SUM(CASE WHEN LOWER(qt.Status) = 'called' THEN 1 ELSE 0 END) AS CalledQueueCount,
          SUM(CASE WHEN LOWER(qt.Status) = 'in_service' THEN 1 ELSE 0 END) AS InServiceQueueCount
        FROM [dbo].[QueueTickets] qt
        WHERE qt.BranchID = @branchId
          AND qt.QueueDate IN (@d, @dNext)
          AND LOWER(qt.Status) IN ('waiting', 'called', 'arrived', 'in_service')
      `),
  ]);

  const booking = bookingRes.recordset[0] || {};
  const queue = queueRes.recordset[0] || {};

  return {
    maxBookingId: Number(booking.MaxBookingId) || 0,
    bookingCount: Number(booking.BookingCount) || 0,
    bookingUpdatedAt: String(booking.BookingUpdatedAt || ''),
    maxQueueId: Number(queue.MaxQueueId) || 0,
    queueCount: Number(queue.QueueCount) || 0,
    calledQueueCount: Number(queue.CalledQueueCount) || 0,
    inServiceQueueCount: Number(queue.InServiceQueueCount) || 0,
    availabilityVersion: getOperationsDayStateVersion(branchId, dateStr),
  };
}

export async function GET(req: NextRequest) {
  const auth = await requirePageAccess('/operations');
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get('date') || getCairoBusinessDate();
    const branchParam = (searchParams.get('branchId') || 'active').trim().toLowerCase();

    const access = await listUserValidBranchAccess(auth.userId);
    const operableIds = new Set(
      access
        .filter((a) => a.canOperate || a.canSwitch || a.canViewReports || a.isDefault)
        .map((a) => a.branchId),
    );
    operableIds.add(auth.activeBranchId);

    let targetBranchIds: number[];
    if (branchParam === 'all') {
      targetBranchIds = [...operableIds];
    } else if (branchParam === 'active' || branchParam === '') {
      targetBranchIds = [auth.activeBranchId];
    } else {
      const bid = Number(branchParam);
      if (!Number.isFinite(bid) || bid <= 0) {
        return NextResponse.json({ ok: false, error: 'معرف الفرع غير صالح' }, { status: 400 });
      }
      if (!operableIds.has(bid)) {
        return NextResponse.json({ ok: false, error: 'غير مصرح بالوصول لهذا الفرع' }, { status: 403 });
      }
      targetBranchIds = [bid];
    }

    const parts = await Promise.all(
      targetBranchIds.map((branchId) => loadBranchPulse(branchId, dateStr)),
    );
    const pulse = mergeOpsBoardPulse(parts);

    return NextResponse.json({
      ok: true,
      date: dateStr,
      fingerprint: buildOpsBoardPulseFingerprint(pulse),
      maxBookingId: pulse.maxBookingId,
      bookingCount: pulse.bookingCount,
    });
  } catch (err) {
    console.error('[operations/flow-board/pulse]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'فشل نبض اللوحة' },
      { status: 500 },
    );
  }
}
