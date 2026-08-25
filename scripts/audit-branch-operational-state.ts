/**
 * Read-only branch operational audit (+ optional safe flag sync).
 *
 * Usage:
 *   npx tsx scripts/audit-branch-operational-state.ts
 *   npx tsx scripts/audit-branch-operational-state.ts --branch-code CAMP_CAESAR
 *   npx tsx scripts/audit-branch-operational-state.ts --branch-code CAMP_CAESAR --sync-flags
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
  const args = process.argv.slice(2);
  const branchCodeArg = args.includes('--branch-code')
    ? args[args.indexOf('--branch-code') + 1]
    : 'CAMP_CAESAR';
  const syncFlags = args.includes('--sync-flags');
  const compareCode = args.includes('--compare')
    ? args[args.indexOf('--compare') + 1]
    : 'GLEEM';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Module = await import('module');
  const orig = (Module as any).default._load;
  (Module as any).default._load = function (request: string, ...rest: unknown[]) {
    if (request === 'server-only') return {};
    return orig.call(this, request, ...rest);
  };

  const { getBranchByCode, listUserBranchAccessRows } = await import(
    '../src/lib/branch/repository'
  );
  const { capabilitiesFor } = await import('../src/lib/branch/lifecycle');
  const { syncOperationalFlagsFromLifecycle } = await import(
    '../src/lib/branch/syncOperationalFlagsFromLifecycle'
  );
  const { getPool, sql } = await import('../src/lib/db');

  async function auditOne(code: string) {
    const branch = await getBranchByCode(code);
    if (!branch) {
      return { code, found: false as const };
    }
    const caps = capabilitiesFor(branch.lifecycleStatus);
    const expected = {
      isActive: caps.isActive,
      publicBookingEnabled: branch.lifecycleStatus === 'PUBLIC_LIVE',
      externalNotificationsEnabled: caps.externalNotifications,
    };
    const flagMismatch =
      branch.isActive !== expected.isActive ||
      branch.publicBookingEnabled !== expected.publicBookingEnabled ||
      branch.externalNotificationsEnabled !== expected.externalNotificationsEnabled;

    const db = await getPool();
    const qbs = await db
      .request()
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        SELECT TOP 1 BookingEnabled, SalonName
        FROM dbo.QueueBookingSettings WHERE BranchID = @branchId
      `);
    const access = await db.request().input('branchId', sql.Int, branch.branchId).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.TblUserBranchAccess
      WHERE BranchID = @branchId AND IsActive = 1 AND CanOperate = 1
    `);
    const assigns = await db.request().input('branchId', sql.Int, branch.branchId).query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.TblEmpBranchAssignment
      WHERE BranchID = @branchId AND IsActive = 1
    `);
    const lastLifecycle = await db.request().input('branchId', sql.Int, branch.branchId).query(`
      SELECT TOP 3 ToStatus, Reason, CreatedAt
      FROM dbo.TblBranchLifecycleAudit
      WHERE BranchID = @branchId
      ORDER BY CreatedAt DESC
    `);
    const lastSmoke = await db.request().input('branchId', sql.Int, branch.branchId).query(`
      SELECT TOP 3 SmokeRunID, Status, CleanupStatus, CompletedAt
      FROM dbo.TblBranchSmokeRun
      WHERE BranchID = @branchId
      ORDER BY SmokeRunID DESC
    `);

    return {
      code,
      found: true as const,
      branchId: branch.branchId,
      lifecycleStatus: branch.lifecycleStatus,
      isActive: branch.isActive,
      publicBookingEnabled: branch.publicBookingEnabled,
      externalNotificationsEnabled: branch.externalNotificationsEnabled,
      expectedFromLifecycle: expected,
      flagMismatch,
      queueBookingEnabled: Boolean(qbs.recordset[0]?.BookingEnabled),
      operatorAccessRows: Number(access.recordset[0]?.Cnt ?? 0),
      activeAssignments: Number(assigns.recordset[0]?.Cnt ?? 0),
      lastLifecycleTransitions: lastLifecycle.recordset,
      lastSmokeRuns: lastSmoke.recordset,
    };
  }

  const target = await auditOne(String(branchCodeArg));
  const reference = await auditOne(String(compareCode));

  console.log(JSON.stringify({ target, reference }, null, 2));

  if (target.found && target.flagMismatch) {
    console.warn(
      `\nFLAG MISMATCH: ${target.code} LifecycleStatus=${target.lifecycleStatus} but operational flags differ from lifecycle contract.`,
    );
    if (syncFlags) {
      const sync = await syncOperationalFlagsFromLifecycle(target.branchId);
      console.log('SYNC RESULT:', JSON.stringify(sync, null, 2));
    } else {
      console.warn('Run with --sync-flags to repair IsActive/public flags from LifecycleStatus only.');
    }
  }

  if (target.found && target.lifecycleStatus === 'SETUP' && target.lastSmokeRuns?.length) {
    const recent = target.lastSmokeRuns[0] as { Status?: string; CompletedAt?: unknown };
    console.warn(
      `\nNOTE: ${target.code} is SETUP but has recent smoke runs (last Status=${recent.Status}). ` +
        'If branch was INTERNAL_LIVE, smoke cleanup may have demoted it — re-activate via admin lifecycle transition.',
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
