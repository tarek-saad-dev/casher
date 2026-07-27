/**
 * Ensure Bookings public WorkDate / absolute interval columns exist (Phase 6B).
 */
import 'server-only';
import { getPool } from '@/lib/db';

let ensured = false;

export async function ensureBookingPublicWorkDateColumns(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF COL_LENGTH(N'dbo.Bookings', N'PublicWorkDate') IS NULL
      ALTER TABLE dbo.Bookings ADD PublicWorkDate DATE NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'PublicDayOffset') IS NULL
      ALTER TABLE dbo.Bookings ADD PublicDayOffset TINYINT NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'AbsoluteStartUtc') IS NULL
      ALTER TABLE dbo.Bookings ADD AbsoluteStartUtc DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'AbsoluteEndUtc') IS NULL
      ALTER TABLE dbo.Bookings ADD AbsoluteEndUtc DATETIME2(0) NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'PlanFingerprint') IS NULL
      ALTER TABLE dbo.Bookings ADD PlanFingerprint NVARCHAR(128) NULL;
    IF COL_LENGTH(N'dbo.Bookings', N'IdempotencyRequestID') IS NULL
      ALTER TABLE dbo.Bookings ADD IdempotencyRequestID BIGINT NULL;
  `);
  ensured = true;
}
