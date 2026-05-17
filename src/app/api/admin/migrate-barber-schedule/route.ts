import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/admin/migrate-barber-schedule
 * Idempotent migration for:
 *  - QueueTickets estimation columns (EstimatedStartTime, EstimatedWaitMinutes, WaitingCountAtCreation)
 *  - QueueTicketServices table
 *
 * NOTE: Employee working hours already live in existing HR tables:
 *   dbo.TblEmpWorkSchedule  (per-day: IsWorkingDay, StartTime, EndTime)
 *   dbo.TblEmpDayOff        (specific date off records)
 * We do NOT create duplicate schedule tables.
 */
export async function POST() {
  const results: string[] = [];

  try {
    const db = await getPool();

    // ── 1. QueueTickets — estimation columns ──────────────────────────────────
    const qtCols: string[] = [];
    const colChecks = [
      { col: 'EstimatedStartTime',    ddl: 'DATETIME2 NULL' },
      { col: 'EstimatedWaitMinutes',  ddl: 'INT NULL' },
      { col: 'WaitingCountAtCreation', ddl: 'INT NULL' },
    ];
    for (const { col, ddl } of colChecks) {
      const chk = await db.request().query(`
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME='QueueTickets' AND COLUMN_NAME='${col}'
      `);
      if (!chk.recordset.length) {
        await db.request().query(
          `ALTER TABLE [dbo].[QueueTickets] ADD [${col}] ${ddl}`
        );
        qtCols.push(`+${col}`);
      }
    }
    results.push(`QueueTickets cols: ${qtCols.length ? qtCols.join(', ') : 'already exist'}`);

    // ── 4. QueueTicketServices ────────────────────────────────────────────────
    const qts = await db.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'QueueTicketServices')
      BEGIN
        CREATE TABLE [dbo].[QueueTicketServices] (
          [ID]              INT IDENTITY(1,1) NOT NULL,
          [QueueTicketID]   INT NOT NULL,
          [ProID]           INT NULL,
          [ProName]         NVARCHAR(200) NULL,
          [Qty]             DECIMAL(10,2) NOT NULL DEFAULT 1,
          [DurationMinutes] INT NULL,
          [Price]           DECIMAL(10,2) NULL,
          CONSTRAINT [PK_QueueTicketServices] PRIMARY KEY CLUSTERED ([ID] ASC),
          CONSTRAINT [FK_QTS_QueueTickets]
            FOREIGN KEY ([QueueTicketID]) REFERENCES [dbo].[QueueTickets]([QueueTicketID]) ON DELETE CASCADE
        );
        CREATE INDEX [IX_QTS_TicketID]
          ON [dbo].[QueueTicketServices] ([QueueTicketID]);
        SELECT 'created' AS Result;
      END
      ELSE
        SELECT 'exists' AS Result;
    `);
    results.push(`QueueTicketServices: ${qts.recordset[0]?.Result}`);

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error('[migrate-barber-schedule]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error', results },
      { status: 500 }
    );
  }
}
