import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getAvailableBarbers } from '@/lib/barberAvailability';

export const runtime = 'nodejs';

export interface OperationAlert {
  id:        string;
  type:      'booking_soon' | 'booking_late' | 'long_wait' | 'barber_unavailable' | 'booking_conflict' | 'arrived_no_queue';
  severity:  'info' | 'warning' | 'danger';
  message:   string;
  relatedId: number | null;
  relatedType: 'booking' | 'ticket' | 'barber' | null;
  action:    'view' | 'call' | 'edit' | 'add_to_queue' | null;
  actionLabel: string | null;
}

/**
 * GET /api/operations/alerts
 * Returns smart operational alerts.
 */
export async function GET() {
  try {
    const db    = await getPool();
    const now   = new Date();
    const today = now.toISOString().slice(0, 10);
    const nowMs = now.getTime();
    const alerts: OperationAlert[] = [];
    let idx = 0;

    // ── 1. Bookings soon (within 15 min) ──────────────────────────────────
    try {
      const soon = await db.request()
        .input('today', sql.Date, today)
        .query(`
          SELECT b.BookingID, b.StartTime, b.AssignedEmpID,
                 c.[Name] AS ClientName, e.EmpName
          FROM [dbo].[Bookings] b
          LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
          LEFT JOIN [dbo].[TblEmp]   e ON e.EmpID    = b.AssignedEmpID
          WHERE b.BookingDate = @today
            AND b.Status IN ('pending','confirmed')
        `);
      const nowTime = now.toTimeString().slice(0, 5);
      for (const b of soon.recordset) {
        const t = String(b.StartTime ?? '').slice(0, 5);
        if (!t) continue;
        const [bh, bm] = t.split(':').map(Number);
        const diffMs = (bh * 60 + bm) * 60000 - (now.getHours() * 60 + now.getMinutes()) * 60000;
        if (diffMs > 0 && diffMs <= 15 * 60000) {
          const mins = Math.round(diffMs / 60000);
          alerts.push({
            id: `soon_${idx++}`,
            type: 'booking_soon',
            severity: 'warning',
            message: `حجز ${b.ClientName ?? 'عميل'} مع ${b.EmpName ?? 'الحلاق'} خلال ${mins} دقيقة`,
            relatedId: b.BookingID,
            relatedType: 'booking',
            action: 'view',
            actionLabel: 'عرض',
          });
        }
      }
    } catch { /* non-fatal */ }

    // ── 2. Late bookings (past + no show) ────────────────────────────────
    try {
      const late = await db.request()
        .input('today', sql.Date, today)
        .query(`
          SELECT b.BookingID, b.StartTime,
                 c.[Name] AS ClientName, e.EmpName
          FROM [dbo].[Bookings] b
          LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
          LEFT JOIN [dbo].[TblEmp]   e ON e.EmpID    = b.AssignedEmpID
          WHERE b.BookingDate = @today
            AND b.Status IN ('pending','confirmed')
        `);
      for (const b of late.recordset) {
        const t = String(b.StartTime ?? '').slice(0, 5);
        if (!t) continue;
        const [bh, bm] = t.split(':').map(Number);
        const diffMs = (now.getHours() * 60 + now.getMinutes()) * 60000 - (bh * 60 + bm) * 60000;
        if (diffMs > 15 * 60000) {
          const mins = Math.round(diffMs / 60000);
          alerts.push({
            id: `late_${idx++}`,
            type: 'booking_late',
            severity: 'danger',
            message: `عميل ${b.ClientName ?? 'غير محدد'} تأخر ${mins} دقيقة عن موعده مع ${b.EmpName ?? 'الحلاق'}`,
            relatedId: b.BookingID,
            relatedType: 'booking',
            action: 'edit',
            actionLabel: 'تعديل',
          });
        }
      }
    } catch { /* non-fatal */ }

    // ── 3. Long waiting queue tickets (> 45 min) ─────────────────────────
    try {
      const waiting = await db.request()
        .input('today', sql.Date, today)
        .query(`
          SELECT qt.QueueTicketID, qt.TicketCode, qt.CreatedTime,
                 c.[Name] AS ClientName, e.EmpName
          FROM [dbo].[QueueTickets] qt
          LEFT JOIN [dbo].[TblClient] c ON c.ClientID = qt.ClientID
          LEFT JOIN [dbo].[TblEmp]   e ON e.EmpID    = qt.EmpID
          WHERE qt.QueueDate = @today AND qt.Status = 'waiting'
        `);
      for (const t of waiting.recordset) {
        if (!t.CreatedTime) continue;
        const [ch, cm, cs] = String(t.CreatedTime).split(':').map(Number);
        const createdMs = new Date(today + 'T' + String(t.CreatedTime).slice(0, 8)).getTime();
        const waitMins = Math.round((nowMs - createdMs) / 60000);
        if (waitMins > 45) {
          alerts.push({
            id: `wait_${idx++}`,
            type: 'long_wait',
            severity: 'warning',
            message: `${t.ClientName ?? 'عميل'} (${t.TicketCode}) ينتظر منذ ${waitMins} دقيقة`,
            relatedId: t.QueueTicketID,
            relatedType: 'ticket',
            action: 'call',
            actionLabel: 'نداء',
          });
        }
      }
    } catch { /* non-fatal */ }

    // ── 4. Barber unavailable with active queue tickets ───────────────────
    try {
      const barbers = await getAvailableBarbers(now);
      const unavailable = barbers.filter(b => !b.IsAvailable);

      const hasTickets = await db.request()
        .input('today', sql.Date, today)
        .query(`
          SELECT DISTINCT EmpID FROM [dbo].[QueueTickets]
          WHERE QueueDate = @today AND Status IN ('waiting','called','arrived')
        `).catch(() => ({ recordset: [] as { EmpID: number }[] }));

      const empIdsWithTickets = new Set(hasTickets.recordset.map(r => r.EmpID));

      for (const b of unavailable) {
        if (empIdsWithTickets.has(b.EmpID)) {
          alerts.push({
            id: `unavail_${idx++}`,
            type: 'barber_unavailable',
            severity: 'danger',
            message: `${b.EmpName} ${b.AvailabilityReason} — لديه عملاء منتظرون`,
            relatedId: b.EmpID,
            relatedType: 'barber',
            action: 'view',
            actionLabel: 'عرض',
          });
        }
      }
    } catch { /* non-fatal */ }

    // ── 5. Arrived bookings not added to queue ────────────────────────────
    try {
      const arrivedNoQueue = await db.request()
        .input('today', sql.Date, today)
        .query(`
          SELECT b.BookingID, c.[Name] AS ClientName, e.EmpName
          FROM [dbo].[Bookings] b
          LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
          LEFT JOIN [dbo].[TblEmp]   e ON e.EmpID    = b.AssignedEmpID
          WHERE b.BookingDate = @today
            AND b.Status = 'arrived'
            AND (b.QueueTicketID IS NULL OR b.QueueTicketID = 0)
        `);
      for (const b of arrivedNoQueue.recordset) {
        alerts.push({
          id: `no_queue_${idx++}`,
          type: 'arrived_no_queue',
          severity: 'info',
          message: `${b.ClientName ?? 'عميل'} وصل لموعده مع ${b.EmpName ?? 'الحلاق'} ولم يُضف للدور`,
          relatedId: b.BookingID,
          relatedType: 'booking',
          action: 'add_to_queue',
          actionLabel: 'إضافة للدور',
        });
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({ alerts, count: alerts.length });
  } catch (err) {
    console.error('[operations/alerts]', err);
    return NextResponse.json({ error: 'فشل تحميل التنبيهات' }, { status: 500 });
  }
}
