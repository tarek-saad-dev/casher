/**
 * POST /api/admin/migrate-queue-lifecycle
 * Runs the queue lifecycle migration (idempotent).
 * Protected: requires admin session.
 */
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST() {
  try {
    // Auth: require admin
    const session = await getSession();
    if (!session || session.UserLevel !== 'admin') {
      return NextResponse.json(
        { ok: false, error: 'غير مصرح - يتطلب صلاحيات المدير' },
        { status: 403 }
      );
    }

    const db = await getPool();

    // Add columns to QueueTickets (idempotent)
    await db.request().query(`
      IF COL_LENGTH('dbo.QueueTickets', 'ExpectedStartAt') IS NULL
        ALTER TABLE dbo.QueueTickets ADD ExpectedStartAt DATETIME2 NULL;
      IF COL_LENGTH('dbo.QueueTickets', 'ExpectedEndAt') IS NULL
        ALTER TABLE dbo.QueueTickets ADD ExpectedEndAt DATETIME2 NULL;
      IF COL_LENGTH('dbo.QueueTickets', 'DurationMinutes') IS NULL
        ALTER TABLE dbo.QueueTickets ADD DurationMinutes INT NULL;
      IF COL_LENGTH('dbo.QueueTickets', 'PrintedAt') IS NULL
        ALTER TABLE dbo.QueueTickets ADD PrintedAt DATETIME2 NULL;
      IF COL_LENGTH('dbo.QueueTickets', 'PrintCount') IS NULL
        ALTER TABLE dbo.QueueTickets ADD PrintCount INT NOT NULL DEFAULT 0;
      IF COL_LENGTH('dbo.QueueTickets', 'LastStatusChangedAt') IS NULL
        ALTER TABLE dbo.QueueTickets ADD LastStatusChangedAt DATETIME2 NULL;
      IF COL_LENGTH('dbo.QueueTickets', 'AutoClosedAt') IS NULL
        ALTER TABLE dbo.QueueTickets ADD AutoClosedAt DATETIME2 NULL;
      IF COL_LENGTH('dbo.QueueTickets', 'AutoCloseReason') IS NULL
        ALTER TABLE dbo.QueueTickets ADD AutoCloseReason NVARCHAR(100) NULL;
    `);

    // Create QueueTicketStatusHistory table (idempotent)
    await db.request().query(`
      IF OBJECT_ID('dbo.QueueTicketStatusHistory', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.QueueTicketStatusHistory (
          ID                INT IDENTITY(1,1) PRIMARY KEY,
          QueueTicketID     INT NOT NULL,
          OldStatus         NVARCHAR(30) NULL,
          NewStatus         NVARCHAR(30) NOT NULL,
          ChangedAt         DATETIME2 NOT NULL DEFAULT GETDATE(),
          ChangedByUserID   INT NULL,
          Source            NVARCHAR(50) NULL,
          Notes             NVARCHAR(500) NULL
        );
        CREATE INDEX IX_QTSH_TicketID ON dbo.QueueTicketStatusHistory(QueueTicketID);
        CREATE INDEX IX_QTSH_ChangedAt ON dbo.QueueTicketStatusHistory(ChangedAt);
      END;
    `);

    // Backfill: set ExpectedStartAt/ExpectedEndAt/DurationMinutes from existing data
    await db.request().query(`
      UPDATE qt
      SET
        qt.ExpectedStartAt = COALESCE(qt.ExpectedStartAt, qt.EstimatedStartTime),
        qt.DurationMinutes = COALESCE(qt.DurationMinutes,
          (SELECT SUM(ISNULL(qts.DurationMinutes, 30))
           FROM dbo.QueueTicketServices qts
           WHERE qts.QueueTicketID = qt.QueueTicketID),
          30),
        qt.LastStatusChangedAt = COALESCE(qt.LastStatusChangedAt,
          qt.ServiceEndedAt, qt.ServiceStartedAt, qt.ArrivedAt, qt.CalledAt, qt.CreatedTime)
      FROM dbo.QueueTickets qt
      WHERE qt.ExpectedStartAt IS NULL OR qt.DurationMinutes IS NULL;

      UPDATE qt
      SET qt.ExpectedEndAt = DATEADD(MINUTE, ISNULL(qt.DurationMinutes, 30), qt.ExpectedStartAt)
      FROM dbo.QueueTickets qt
      WHERE qt.ExpectedEndAt IS NULL AND qt.ExpectedStartAt IS NOT NULL;
    `);

    return NextResponse.json({ ok: true, message: 'Queue lifecycle migration complete' });
  } catch (err) {
    console.error('[migrate-queue-lifecycle]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Migration failed' },
      { status: 500 }
    );
  }
}
