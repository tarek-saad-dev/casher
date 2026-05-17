import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getAvailableBarbers } from '@/lib/barberAvailability';

// ── Inline idempotent migration for estimate columns ─────────────────────────
async function ensureEstimateColumns(db: Awaited<ReturnType<typeof getPool>>): Promise<void> {
  try {
    await db.request().query(`
      IF COL_LENGTH('dbo.QueueTickets', 'EstimatedStartTime') IS NULL
        ALTER TABLE dbo.QueueTickets ADD EstimatedStartTime DATETIME2 NULL;
      IF COL_LENGTH('dbo.QueueTickets', 'EstimatedWaitMinutes') IS NULL
        ALTER TABLE dbo.QueueTickets ADD EstimatedWaitMinutes INT NULL;
      IF COL_LENGTH('dbo.QueueTickets', 'WaitingCountAtCreation') IS NULL
        ALTER TABLE dbo.QueueTickets ADD WaitingCountAtCreation INT NULL;
    `);
  } catch (e) {
    console.warn('[operations overview] ensureEstimateColumns failed (non-fatal):', e);
  }
}

let _overviewEstColsVerified = false;

async function getOverviewEstCols(db: Awaited<ReturnType<typeof getPool>>): Promise<string> {
  if (!_overviewEstColsVerified) {
    await ensureEstimateColumns(db);
    _overviewEstColsVerified = true;
  }
  try {
    const check = await db.request().query(`
      SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME='QueueTickets'
        AND COLUMN_NAME IN ('EstimatedStartTime','EstimatedWaitMinutes','WaitingCountAtCreation')
    `);
    if (check.recordset[0]?.cnt === 3) {
      return `qt.EstimatedStartTime,
            qt.EstimatedWaitMinutes,
            qt.WaitingCountAtCreation`;
    }
  } catch { /* fallthrough */ }
  return `CAST(NULL AS DATETIME2) AS EstimatedStartTime,
            CAST(NULL AS INT) AS EstimatedWaitMinutes,
            CAST(NULL AS INT) AS WaitingCountAtCreation`;
}

export const runtime = 'nodejs';

/**
 * GET /api/operations/overview
 * Returns full operations board snapshot: KPIs, barbers, queue, bookings.
 */
export async function GET() {
  try {
    const db   = await getPool();
    const now  = new Date();
    // Use Egypt local date to match the date stored by the queue POST route
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }); // YYYY-MM-DD

    // ── 1. Barber availability ─────────────────────────────────────────────
    const barbers = await getAvailableBarbers(now);
    const availableBarbersCount = barbers.filter(b => b.IsAvailable).length;

    // ── 2. Queue tickets today ─────────────────────────────────────────────
    let queueTickets: any[] = [];
    let waitingQueueCount = 0;
    let averageWaitMinutes = 0;

    console.log('[operations overview] date filter', today);

    try {
      // Diagnostic: show latest 5 tickets in DB regardless of date filter
      const diagRes = await db.request().query(`
        SELECT TOP 5
          qt.QueueTicketID, qt.TicketCode, qt.QueueDate, qt.Status,
          qt.ClientID, qt.EmpID, qt.CreatedTime
        FROM [dbo].[QueueTickets] qt
        ORDER BY qt.QueueTicketID DESC
      `).catch(() => ({ recordset: [] as any[] }));
      console.log('[operations overview] latest 5 tickets in DB (unfiltered)', diagRes.recordset);

      // Defensive: run migration + pick real columns or NULL aliases
      const estColsSql = await getOverviewEstCols(db);

      const qRes = await db.request()
        .input('today', sql.Date, today)
        .query(`
          SELECT
            qt.QueueTicketID, qt.TicketCode, qt.TicketNumber, qt.EmpID,
            qt.ClientID, qt.QueueDate, qt.CreatedTime,
            qt.Status, qt.Priority, qt.Notes,
            qt.CalledAt, qt.ArrivedAt, qt.ServiceStartedAt, qt.ServiceEndedAt,
            qt.CancelledAt,
            ${estColsSql},
            c.[Name]  AS ClientName,
            c.Mobile  AS ClientMobile,
            e.EmpName
          FROM [dbo].[QueueTickets] qt
          LEFT JOIN [dbo].[TblClient] c ON c.ClientID = qt.ClientID
          LEFT JOIN [dbo].[TblEmp]   e ON e.EmpID    = qt.EmpID
          WHERE qt.QueueDate = @today
            AND qt.Status NOT IN ('cancelled', 'done')
          ORDER BY qt.Priority DESC, qt.TicketNumber ASC
        `);
      queueTickets = qRes.recordset;

      console.log('[operations overview] queue rows after date filter', queueTickets.map((t: any) => ({
        id: t.QueueTicketID, code: t.TicketCode,
        status: t.Status, queueDate: t.QueueDate,
        clientId: t.ClientID, empId: t.EmpID,
      })));

      // Derive counts from the returned array (single source of truth)
      waitingQueueCount = queueTickets.filter((t: any) =>
        ['waiting', 'called', 'arrived'].includes(String(t.Status).toLowerCase())
      ).length;

      // Average estimated wait for waiting tickets
      const waitTimes = queueTickets
        .filter((t: any) => String(t.Status).toLowerCase() === 'waiting' && t.EstimatedWaitMinutes != null)
        .map((t: any) => Number(t.EstimatedWaitMinutes));
      if (waitTimes.length > 0) {
        averageWaitMinutes = Math.round(waitTimes.reduce((a: number, b: number) => a + b, 0) / waitTimes.length);
      }
    } catch (qErr) {
      console.error('[operations overview] queue fetch failed', qErr);
      /* QueueTickets may not exist yet */
    }

    // ── 3. Bookings today ─────────────────────────────────────────────────
    let bookings: any[] = [];
    let upcomingBookingsCount = 0;

    try {
      const bRes = await db.request()
        .input('today', sql.Date, today)
        .query(`
          SELECT
            b.BookingID, b.ClientID, b.AssignedEmpID, b.BookingDate,
            b.StartTime, b.EndTime, b.Status, b.Source, b.Notes,
            b.QueueTicketID, b.CreatedAt, b.CancelledAt, b.CancelReason,
            c.[Name]  AS ClientName,
            c.Mobile  AS ClientMobile,
            e.EmpName,
            (SELECT COUNT(*) FROM [dbo].[BookingServices] bs WHERE bs.BookingID = b.BookingID) AS ServiceCount
          FROM [dbo].[Bookings] b
          LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
          LEFT JOIN [dbo].[TblEmp]   e ON e.EmpID    = b.AssignedEmpID
          WHERE b.BookingDate = @today
          ORDER BY b.StartTime ASC
        `);
      bookings = bRes.recordset;

      const nowTime = now.toTimeString().slice(0, 5);
      upcomingBookingsCount = bookings.filter(b =>
        ['pending', 'confirmed'].includes(b.Status) &&
        String(b.StartTime ?? '').slice(0, 5) >= nowTime
      ).length;
    } catch { /* Bookings may not exist yet */ }

    // ── 4. Shift label ────────────────────────────────────────────────────
    const h = now.getHours();
    const shift = h < 12 ? 'الصبح' : h < 18 ? 'الظهر' : 'المساء';

    // ── 5. Per-barber enrichment (current ticket + next booking) ──────────
    const enrichedBarbers = barbers.map(b => {
      const inService = queueTickets.find(
        t => t.EmpID === b.EmpID && t.Status === 'in_service'
      );
      const nextWaiting = queueTickets.find(
        t => t.EmpID === b.EmpID && ['waiting', 'called', 'arrived'].includes(t.Status)
      );
      const nowTime = now.toTimeString().slice(0, 5);
      const nextBooking = bookings.find(
        bk => bk.AssignedEmpID === b.EmpID &&
          ['pending', 'confirmed'].includes(bk.Status) &&
          String(bk.StartTime ?? '').slice(0, 5) >= nowTime
      );
      return {
        ...b,
        currentTicket:  inService  ?? null,
        nextTicket:     nextWaiting ?? null,
        nextBooking:    nextBooking ?? null,
      };
    });

    return NextResponse.json({
      date: today,
      shift,
      availableBarbersCount,
      waitingQueueCount,
      upcomingBookingsCount,
      averageWaitMinutes,
      alertsCount: 0, // filled by /api/operations/alerts
      barbers:      enrichedBarbers,
      queueTickets,
      bookings,
    });
  } catch (err) {
    console.error('[operations/overview]', err);
    return NextResponse.json({ error: 'فشل تحميل لوحة التشغيل' }, { status: 500 });
  }
}
