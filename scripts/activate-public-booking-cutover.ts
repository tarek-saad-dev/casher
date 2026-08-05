#!/usr/bin/env npx tsx
/**
 * Phase K — enable public booking for ready PUBLIC_LIVE operational branches.
 * BOOKING_PUBLIC_CUTOVER=1 npx tsx scripts/activate-public-booking-cutover.ts
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  if (process.env.BOOKING_PUBLIC_CUTOVER !== '1') {
    console.log('Set BOOKING_PUBLIC_CUTOVER=1 to enable cutover');
    process.exit(0);
  }

  const { getPool, sql } = await import('../src/lib/db');
  const { listPublicDiscoverableBranches, invalidatePublicBookingBranchContextCache } =
    await import('../src/lib/booking/publicBookingBranchContext');
  const { invalidatePublicSettingsCache } = await import('../src/lib/publicBookingHelpers');

  const db = await getPool();
  const branches = await db.request().query(`
    SELECT b.BranchID, b.BranchCode, b.BranchName,
      CAST(ISNULL(b.IsActive,0) AS BIT) IsActive,
      ISNULL(b.LifecycleStatus,N'') LifecycleStatus,
      CAST(ISNULL(b.PublicBookingEnabled,0) AS BIT) PublicBookingEnabled,
      CAST(ISNULL(q.BookingEnabled,0) AS BIT) QbsBookingEnabled
    FROM dbo.TblBranch b
    LEFT JOIN dbo.QueueBookingSettings q ON q.BranchID = b.BranchID
    WHERE b.BranchCode IN (N'GLEEM', N'CAMP_CAESAR')
    ORDER BY b.BranchID
  `);

  const readiness = [];
  for (const row of branches.recordset as Array<Record<string, unknown>>) {
    const code = String(row.BranchCode);
    const lifecycle = String(row.LifecycleStatus);
    const isActive = Boolean(row.IsActive);
    const pub = Boolean(row.PublicBookingEnabled);
    const qbs = Boolean(row.QbsBookingEnabled);
    const ready =
      isActive && lifecycle === 'PUBLIC_LIVE' && pub && code !== 'PH1GTEST';
    readiness.push({
      branchCode: code,
      branchId: Number(row.BranchID),
      lifecycle,
      isActive,
      publicBookingEnabled: pub,
      qbsBookingEnabled: qbs,
      readyForPublicBooking: ready,
    });

    if (ready && !qbs) {
      await db
        .request()
        .input('branchId', sql.Int, Number(row.BranchID))
        .query(`
          UPDATE dbo.QueueBookingSettings
          SET BookingEnabled = 1, UpdatedAt = GETDATE()
          WHERE BranchID = @branchId
        `);
      invalidatePublicSettingsCache(Number(row.BranchID));
    }
  }

  invalidatePublicBookingBranchContextCache();
  const discoverable = await listPublicDiscoverableBranches();

  const after = await db.request().query(`
    SELECT b.BranchCode,
      CAST(ISNULL(b.IsActive,0) AS BIT) IsActive,
      ISNULL(b.LifecycleStatus,N'') LifecycleStatus,
      CAST(ISNULL(b.PublicBookingEnabled,0) AS BIT) PublicBookingEnabled,
      CAST(ISNULL(q.BookingEnabled,0) AS BIT) QbsBookingEnabled
    FROM dbo.TblBranch b
    LEFT JOIN dbo.QueueBookingSettings q ON q.BranchID = b.BranchID
    WHERE b.BranchCode IN (N'GLEEM', N'CAMP_CAESAR')
  `);

  console.log(
    JSON.stringify(
      {
        readinessBefore: readiness,
        after: after.recordset,
        publicDiscovery: discoverable.map((b) => b.branchCode),
      },
      null,
      2,
    ),
  );

  const missing = ['GLEEM', 'CAMP_CAESAR'].filter(
    (c) => !discoverable.some((b) => b.branchCode === c),
  );
  if (missing.length) {
    console.error('Missing from public discovery:', missing);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
