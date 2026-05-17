import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET /api/admin/migrate-queue-estimate-cols
 *
 * Idempotent migration using COL_LENGTH (SQL Server native).
 * Adds EstimatedStartTime, EstimatedWaitMinutes, WaitingCountAtCreation
 * to dbo.QueueTickets if they do not already exist.
 */
export async function GET() {
  try {
    const db = await getPool();

    await db.request().query(`
      IF COL_LENGTH('dbo.QueueTickets', 'EstimatedStartTime') IS NULL
      BEGIN
        ALTER TABLE dbo.QueueTickets
        ADD EstimatedStartTime DATETIME2 NULL;
      END;

      IF COL_LENGTH('dbo.QueueTickets', 'EstimatedWaitMinutes') IS NULL
      BEGIN
        ALTER TABLE dbo.QueueTickets
        ADD EstimatedWaitMinutes INT NULL;
      END;

      IF COL_LENGTH('dbo.QueueTickets', 'WaitingCountAtCreation') IS NULL
      BEGIN
        ALTER TABLE dbo.QueueTickets
        ADD WaitingCountAtCreation INT NULL;
      END;
    `);

    // Verify
    const verify = await db.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'QueueTickets'
        AND COLUMN_NAME IN ('EstimatedStartTime','EstimatedWaitMinutes','WaitingCountAtCreation')
    `);

    return NextResponse.json({
      ok: true,
      columns: verify.recordset,
      message: verify.recordset.length === 3
        ? 'Migration OK — all 3 columns present'
        : `تحذير: وُجد ${verify.recordset.length} من 3 أعمدة`,
    });
  } catch (err) {
    console.error('[migrate-queue-estimate-cols]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
