/**
 * Phase 1S — transition Camp Caesar SETUP → INTERNAL_LIVE after readiness green.
 */
import Module from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

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
    /* */
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const { evaluateBranchReadiness } = await import('../../src/lib/branch/branchReadinessService');
  const { transitionBranchLifecycle } = await import('../../src/lib/branch/branchLifecycleTransition');
  const { getBranchById, listActiveBranches } = await import('../../src/lib/branch/repository');
  const { listPublicActiveBranches } = await import('../../src/lib/branch/bookingQueueOwnership');
  const { canBranchAppearInPublicBooking } = await import('../../src/lib/branch/publicBranchVisibility');
  const { listSwitchableBranchesForUser } = await import('../../src/lib/branch/switchBranch');

  const CC = 3;
  const GLEEM = 1;
  const ACTOR = 10;

  const before = await evaluateBranchReadiness(CC);
  if (!before.isReadyForSmoke) {
    console.warn(
      'Smoke blockers:',
      before.blockers
        .filter((b) => b.requiredFor.includes('smoke'))
        .map((b) => b.key),
    );
  }
  if (!before.isReadyForInternalLive) {
    throw new Error(
      `Not ready for INTERNAL_LIVE: ${before.blockers
        .filter((b) => b.requiredFor.includes('internal_live'))
        .map((b) => b.key)
        .join(', ')}`,
    );
  }

  // Contract path: SETUP → SMOKE_TEST → INTERNAL_LIVE
  if ((await getBranchById(CC))?.lifecycleStatus === 'SETUP') {
    if (!before.isReadyForSmoke) {
      throw new Error('Not ready for SMOKE_TEST gate');
    }
    await transitionBranchLifecycle({
      branchId: CC,
      targetStatus: 'SMOKE_TEST',
      actorUserId: ACTOR,
      reason: 'مرحلة smoke قبل التشغيل الداخلي لكامب شيزار 2026-07-27',
    });
  }

  const mid = await getBranchById(CC);
  if (mid?.lifecycleStatus !== 'SMOKE_TEST' && mid?.lifecycleStatus !== 'INTERNAL_LIVE') {
    throw new Error(`Unexpected lifecycle before INTERNAL_LIVE: ${mid?.lifecycleStatus}`);
  }

  const transition =
    mid.lifecycleStatus === 'INTERNAL_LIVE'
      ? {
          fromStatus: 'SMOKE_TEST' as const,
          toStatus: 'INTERNAL_LIVE' as const,
          readinessBlockers: 0,
          branch: mid,
        }
      : await transitionBranchLifecycle({
          branchId: CC,
          targetStatus: 'INTERNAL_LIVE',
          actorUserId: ACTOR,
          reason: 'فتح فرع كامب شيزار للتشغيل الداخلي بتاريخ 2026-07-27',
          smokeRunId: 18,
        });

  const branch = await getBranchById(CC);
  const qbs = await (await getPool())
    .request()
    .input('b', sql.Int, CC)
    .query(`SELECT BookingEnabled FROM dbo.QueueBookingSettings WHERE BranchID=@b`);

  const active = await listActiveBranches();
  const publicActive = await listPublicActiveBranches();
  const publicVisible = await canBranchAppearInPublicBooking(CC);
  const switcherAuth = await listSwitchableBranchesForUser(ACTOR, GLEEM);
  // Unauthorized: force CanOperate false path via user without access if available
  let unauthorizedSees = false;
  try {
    const sw = await listSwitchableBranchesForUser(999999, GLEEM);
    unauthorizedSees = sw.some((b) => b.branchId === CC);
  } catch {
    unauthorizedSees = false;
  }

  const gleem = await getBranchById(GLEEM);
  const ziadOnCcFri = await (await getPool()).request().query(`
    SELECT DayOfWeek, IsWorking FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID=12 AND BranchID=3 AND IsActive=1 AND DayOfWeek=5
  `);

  const report = {
    transition: {
      from: transition.fromStatus,
      to: transition.toStatus,
      readinessBlockers: transition.readinessBlockers,
    },
    finalFlags: {
      lifecycleStatus: branch?.lifecycleStatus,
      isActive: branch?.isActive,
      publicBookingEnabled: branch?.publicBookingEnabled,
      queueBookingEnabled: Boolean(qbs.recordset[0]?.BookingEnabled),
      externalNotificationsEnabled: branch?.externalNotificationsEnabled,
    },
    postActivation: {
      inActiveBranches: active.some((b) => b.branchCode === 'CAMP_CAESAR' && b.isActive),
      inPublicActiveBranches: publicActive.some((b) => b.branchId === CC),
      publicBookingVisible: publicVisible,
      authorizedSwitcherSees: switcherAuth.some((b) => b.branchId === CC),
      unauthorizedSwitcherSees: unauthorizedSees,
      ziadFridayCcWorking: Boolean(ziadOnCcFri.recordset[0]?.IsWorking),
      gleemStillPublicLive: gleem?.lifecycleStatus === 'PUBLIC_LIVE' && gleem?.isActive === true,
    },
  };

  writeFileSync(
    join(__dirname, '_phase1s-activation-result.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));

  if (branch?.lifecycleStatus !== 'INTERNAL_LIVE') throw new Error('lifecycle not INTERNAL_LIVE');
  if (!branch.isActive) throw new Error('IsActive must be 1');
  if (branch.publicBookingEnabled) throw new Error('PublicBookingEnabled must stay 0');
  if (publicVisible) throw new Error('public visibility must stay false');
  if (publicActive.some((b) => b.branchId === CC)) throw new Error('must not be in public branches');
  if (!active.some((b) => b.branchCode === 'CAMP_CAESAR' && b.isActive)) {
    throw new Error('must be in listActiveBranches');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
