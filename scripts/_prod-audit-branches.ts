/**
 * One-off production branch audit (read-only). Not for commit.
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

  const { getBranchByCode } = await import('../src/lib/branch/repository');
  const { getPool } = await import('../src/lib/db');

  const cc = await getBranchByCode('CAMP_CAESAR');
  const gleem = await getBranchByCode('GLEEM');
  const db = await getPool();

  const qbs = await db.request().query(`
    SELECT b.BranchCode, q.BranchID, q.BookingEnabled, q.SalonName
    FROM dbo.QueueBookingSettings q
    INNER JOIN dbo.TblBranch b ON b.BranchID = q.BranchID
    WHERE b.BranchCode IN (N'CAMP_CAESAR', N'GLEEM')
  `);

  const access = await db.request().query(`
    SELECT uba.UserID, uba.BranchID, b.BranchCode, uba.IsActive, uba.CanOperate,
           uba.CanSwitch, uba.ValidFrom, uba.ValidTo
    FROM dbo.TblUserBranchAccess uba
    INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
    WHERE b.BranchCode = N'CAMP_CAESAR' AND uba.IsActive = 1
    ORDER BY uba.UserID
  `);

  const smoke = await db.request().query(`
    SELECT TOP 5 SmokeRunID, Status, CleanupStatus, CompletedAt, Purpose
    FROM dbo.TblBranchSmokeRun
    WHERE BranchID = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'CAMP_CAESAR')
    ORDER BY SmokeRunID DESC
  `);

  const lifecycle = await db.request().query(`
    SELECT TOP 5 ToStatus, Reason, CreatedAt
    FROM dbo.TblBranchLifecycleAudit
    WHERE BranchID = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'CAMP_CAESAR')
    ORDER BY CreatedAt DESC
  `);

  console.log(
    JSON.stringify(
      {
        campCaesar: cc,
        gleem: gleem
          ? {
              branchId: gleem.branchId,
              branchCode: gleem.branchCode,
              lifecycleStatus: gleem.lifecycleStatus,
              isActive: gleem.isActive,
              publicBookingEnabled: gleem.publicBookingEnabled,
              externalNotificationsEnabled: gleem.externalNotificationsEnabled,
            }
          : null,
        queueBookingSettings: qbs.recordset,
        campCaesarAccess: access.recordset,
        recentSmokeRuns: smoke.recordset,
        recentLifecycleAudit: lifecycle.recordset,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
