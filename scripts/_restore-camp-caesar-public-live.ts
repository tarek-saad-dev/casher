/**
 * One-off repair: restore CAMP_CAESAR after phase6c smoke harness demotion regression.
 * Not for commit — run manually when branch drifted to SMOKE_TEST/SETUP inactive.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* optional */
  }
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Module = await import('module');
  const orig = (Module as any).default._load;
  (Module as any).default._load = function (request: string, ...rest: unknown[]) {
    if (request === 'server-only') return {};
    return orig.call(this, request, ...rest);
  };

  const { getPool, sql } = await import('../src/lib/db');
  const db = await getPool();

  const before = (
    await db.request().query(`
      SELECT BranchID, BranchCode, LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
      FROM dbo.TblBranch WHERE BranchCode = N'CAMP_CAESAR'
    `)
  ).recordset[0];
  console.log('BEFORE:', before);

  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    const fromStatus = String(before.LifecycleStatus);
    const branchId = Number(before.BranchID);
    await new sql.Request(tx)
      .input('branchId', sql.Int, branchId)
      .input('fromStatus', sql.NVarChar(30), fromStatus)
      .query(`
      UPDATE dbo.TblBranch
      SET LifecycleStatus = N'PUBLIC_LIVE',
          IsActive = 1,
          PublicBookingEnabled = 1,
          ExternalNotificationsEnabled = 1,
          UpdatedAt = SYSUTCDATETIME()
      WHERE BranchID = @branchId
        AND BranchCode = N'CAMP_CAESAR';

      UPDATE dbo.QueueBookingSettings
      SET BookingEnabled = 1, UpdatedAt = GETDATE()
      WHERE BranchID = @branchId;

      UPDATE dbo.TblBranchSmokeRun
      SET Status = N'ABORTED',
          CleanupStatus = N'COMPLETED',
          CompletedAt = SYSUTCDATETIME()
      WHERE BranchID = @branchId
        AND Status = N'RUNNING'
        AND Purpose = N'booking-phase-6c-final-create-proof';

      INSERT INTO dbo.TblBranchLifecycleAudit (
        BranchID, FromStatus, ToStatus, Reason, ActorUserID
      )
      VALUES (
        @branchId, @fromStatus, N'PUBLIC_LIVE',
        N'repair: restore CAMP_CAESAR after phase6c smoke lifecycle demotion', 0
      );
    `);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  const after = (
    await db.request().query(`
      SELECT BranchID, BranchCode, LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
      FROM dbo.TblBranch WHERE BranchCode = N'CAMP_CAESAR'
    `)
  ).recordset[0];
  console.log('AFTER:', after);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
