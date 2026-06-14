/**
 * POST /api/queue/settle-expired
 *
 * Settles (marks as no_show) all queue tickets that are expired candidates
 * for the current business date. Used by the "تسوية منتهية" button in operations.
 *
 * Body: { date?: string }
 * Response: { ok: true, settled: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getCairoBusinessDate } from '@/lib/businessDate';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const userID = session?.UserID ?? 0;
    const body = await req.json().catch(() => ({}));
    const date = (body as any).date || getCairoBusinessDate();

    const db = await getPool();

    // Find tickets that are waiting/called/arrived and past their ExpectedEndAt + 15 min grace
    // Only settle if ExpectedEndAt column exists
    const colCheck = await db.request().query(`
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'QueueTickets' AND COLUMN_NAME = 'ExpectedEndAt'
    `);

    if (!colCheck.recordset.length) {
      return NextResponse.json({ ok: true, settled: 0, message: 'ExpectedEndAt column not found — run migration first' });
    }

    const result = await db.request()
      .input('date', sql.Date, date)
      .input('userID', sql.Int, userID)
      .query(`
        UPDATE qt
        SET qt.Status = 'no_show',
            qt.AutoClosedAt = GETDATE(),
            qt.AutoCloseReason = N'settled_by_operator'
        OUTPUT INSERTED.QueueTicketID
        FROM dbo.QueueTickets qt
        WHERE qt.QueueDate = @date
          AND LOWER(qt.Status) IN ('waiting', 'called')
          AND qt.ExpectedEndAt IS NOT NULL
          AND DATEADD(MINUTE, 15, qt.ExpectedEndAt) < GETDATE()
      `);

    const settledCount = result.recordset.length;

    // Write history for each settled ticket
    if (settledCount > 0) {
      for (const row of result.recordset) {
        await db.request()
          .input('ticketId', sql.Int, row.QueueTicketID)
          .input('userID', sql.Int, userID)
          .query(`
            IF OBJECT_ID('dbo.QueueTicketStatusHistory', 'U') IS NOT NULL
              INSERT INTO dbo.QueueTicketStatusHistory
                (QueueTicketID, OldStatus, NewStatus, ChangedByUserID, Source, Notes)
              VALUES (@ticketId, 'expired', 'no_show', @userID, 'operator_settle', N'تسوية جماعية')
          `)
          .catch(() => {});
      }
    }

    return NextResponse.json({ ok: true, settled: settledCount });
  } catch (err) {
    console.error('[settle-expired]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 }
    );
  }
}
