#!/usr/bin/env npx tsx
/**
 * Phase 1N cleanup helper — allow PH1GTEST or CAMP_CAESAR; refuse GLEEM.
 *
 * Usage:
 *   npx tsx scripts/branch-smoke/cleanup-branch-smoke-run.ts --smoke-run-id=N --confirm
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moduleWithLoad = Module as any;
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(this, request, ...rest);
};

function parseArgs(argv: string[]) {
  let smokeRunId = 0;
  let confirm = false;
  let actorUserId = 0;
  for (const arg of argv) {
    if (arg.startsWith('--smoke-run-id=')) {
      smokeRunId = Number(arg.slice('--smoke-run-id='.length));
    } else if (arg === '--confirm') {
      confirm = true;
    } else if (arg.startsWith('--actor-user-id=')) {
      actorUserId = Number(arg.slice('--actor-user-id='.length));
    }
  }
  return { smokeRunId, confirm, actorUserId };
}

async function main() {
  const { smokeRunId, confirm, actorUserId } = parseArgs(process.argv.slice(2));
  if (!smokeRunId) {
    console.error('Refuse: --smoke-run-id is required');
    process.exit(2);
  }
  if (!confirm) {
    console.error('Dry-run only. Pass --confirm to execute cleanup.');
    console.error(
      `Would cleanup SmokeRunID=${smokeRunId} on allowed smoke branch only (refuse GLEEM).`,
    );
    process.exit(0);
  }

  const { getPool, sql } = await import('../../src/lib/db');
  const { cleanupBranchSmokeRun, getBranchSmokeRun, GLEEM_BRANCH_CODE } = await import(
    '../../src/lib/branch/branchSmokeService'
  );
  const { isAllowedSmokeBranchCode } = await import('../../src/lib/branch/smokeBranchPolicy');
  const { getBranchByCode, getBranchById } = await import('../../src/lib/branch/repository');

  const gleem = await getBranchByCode(GLEEM_BRANCH_CODE);
  const db = await getPool();
  const owned = await db
    .request()
    .input('runId', sql.BigInt, smokeRunId)
    .query(`SELECT BranchID FROM dbo.TblBranchSmokeRun WHERE SmokeRunID = @runId`);
  if (!owned.recordset[0]) {
    console.error('Refuse: smoke run not found');
    process.exit(2);
  }
  const runBranchId = Number(owned.recordset[0].BranchID);
  if (gleem && runBranchId === gleem.branchId) {
    console.error('Refuse: cleanup targeting GLEEM BranchID');
    process.exit(2);
  }
  const branch = await getBranchById(runBranchId);
  if (!branch || !isAllowedSmokeBranchCode(branch.branchCode)) {
    console.error('Refuse: smoke run BranchID is not an allowed smoke branch');
    process.exit(2);
  }

  const before = await getBranchSmokeRun(branch.branchId, smokeRunId);
  console.log('Artifacts before cleanup:', before.artifacts.length);

  const result = await cleanupBranchSmokeRun({
    branchId: branch.branchId,
    smokeRunId,
    actorUserId: actorUserId || 0,
  });

  console.log('Cleanup result:', result);
  console.log(`${branch.branchCode} returned to SETUP; PublicBookingEnabled=0`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
