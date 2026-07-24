#!/usr/bin/env npx tsx
/**
 * Phase 1G — bootstrap a new branch end-to-end:
 *   create TblBranch row -> seed QueueBookingSettings -> optionally seed
 *   partner shares -> optionally grant a user branch access -> optionally
 *   assign an employee -> optionally print an operational readiness report.
 *
 * Default target: cloud / last132. Refuses to run against an unexpected
 * database. Never prints secrets. Writes require --confirm; without it this
 * performs a dry run (validates args + connects + prints the plan only).
 *
 * Does NOT add a branch switcher, does NOT touch HR BranchID, does NOT
 * redesign business rules — it only calls the existing Phase 1G bootstrap
 * helpers in `@/lib/branch/bootstrap`.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-branch.ts \
 *     --branch-code=SIDIBISHR --branch-name="سيدي بشر" --short-name=SB \
 *     --address="..." --phone="..." \
 *     --timezone=Africa/Cairo --cutoff=04:00 \
 *     --copy-settings-from=GLEEM --seed-partner-shares-from=GLEEM \
 *     --grant-user-id=12 --assign-emp-id=34 \
 *     --readiness --confirm
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// `server-only` throws when imported outside a bundler's "react-server"
// condition. Stub it out so `@/lib/branch/*` modules load under plain tsx.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moduleWithLoad = Module as any;
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

type ParsedArgs = Record<string, string | boolean>;

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) {
      args[arg.slice(2)] = true;
    } else {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return args;
}

function strOpt(args: ParsedArgs, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function boolOpt(args: ParsedArgs, key: string): boolean {
  return args[key] === true || args[key] === 'true';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const mode = (strOpt(args, 'mode') ?? process.env.AUDIT_DB_TARGET ?? 'cloud').toLowerCase();
  const expectedDatabase = strOpt(args, 'expected-database') ?? 'last132';
  const confirm = boolOpt(args, 'confirm');
  const printReadiness = boolOpt(args, 'readiness');
  const skipPartnerShares = boolOpt(args, 'skip-partner-shares');

  const branchCode = strOpt(args, 'branch-code');
  const branchName = strOpt(args, 'branch-name');
  const shortName = strOpt(args, 'short-name') ?? null;
  const address = strOpt(args, 'address') ?? null;
  const phone = strOpt(args, 'phone') ?? null;
  const timeZone = strOpt(args, 'timezone') ?? 'Africa/Cairo';
  const cutoff = strOpt(args, 'cutoff') ?? '04:00';
  const copySettingsFrom = strOpt(args, 'copy-settings-from') ?? 'GLEEM';
  const seedPartnerSharesFromRaw = strOpt(args, 'seed-partner-shares-from') ?? 'GLEEM';
  const seedPartnerSharesFrom = skipPartnerShares ? null : seedPartnerSharesFromRaw;

  const grantUserIdRaw = strOpt(args, 'grant-user-id');
  const assignEmpIdRaw = strOpt(args, 'assign-emp-id');
  const grantUserId = grantUserIdRaw != null ? Number(grantUserIdRaw) : null;
  const assignEmpId = assignEmpIdRaw != null ? Number(assignEmpIdRaw) : null;

  console.log('Phase 1G branch bootstrap');
  console.log(`  selected mode: ${mode}`);
  console.log(`  expected database: ${expectedDatabase}`);
  console.log(`  write mode: ${confirm ? 'CONFIRMED (will write)' : 'dry run (pass --confirm to write)'}`);

  if (!branchCode || !branchName) {
    console.error('Refusing: --branch-code and --branch-name are required.');
    process.exit(1);
  }
  if (mode !== 'cloud' && expectedDatabase === 'last132') {
    console.error('Refusing: default last132 target requires cloud mode.');
    process.exit(1);
  }
  if (grantUserIdRaw != null && (grantUserId == null || Number.isNaN(grantUserId))) {
    console.error('Refusing: --grant-user-id must be numeric.');
    process.exit(1);
  }
  if (assignEmpIdRaw != null && (assignEmpId == null || Number.isNaN(assignEmpId))) {
    console.error('Refusing: --assign-emp-id must be numeric.');
    process.exit(1);
  }

  const { setDbTarget, getPool, closePool } = await import('@/lib/db');
  await setDbTarget(mode === 'local' ? 'local' : 'cloud');

  const db = await getPool();
  const dbNameRes = await db.request().query('SELECT DB_NAME() AS dbName');
  const connectedDatabase = String(dbNameRes.recordset[0].dbName);
  console.log(`  connected database: ${connectedDatabase}`);

  if (connectedDatabase !== expectedDatabase) {
    console.error(
      `Refusing: connected database "${connectedDatabase}" != expected "${expectedDatabase}".`,
    );
    await closePool();
    process.exit(1);
  }

  console.log('  planned branch:');
  console.log(`    branchCode: ${branchCode}`);
  console.log(`    branchName: ${branchName}`);
  console.log(`    shortName: ${shortName ?? '(none)'}`);
  console.log(`    address: ${address ? '(set)' : '(none)'}`);
  console.log(`    phone: ${phone ? '(set)' : '(none)'}`);
  console.log(`    timeZone: ${timeZone}`);
  console.log(`    businessDayCutoffTime: ${cutoff}`);
  console.log(`    copySettingsFrom: ${copySettingsFrom}`);
  console.log(`    seedPartnerSharesFrom: ${seedPartnerSharesFrom ?? '(skipped)'}`);
  console.log(`    grantUserId: ${grantUserId ?? '(none)'}`);
  console.log(`    assignEmpId: ${assignEmpId ?? '(none)'}`);
  console.log(`    printReadiness: ${printReadiness}`);

  if (!confirm) {
    console.log('DRY RUN — no changes written. Pass --confirm to actually bootstrap this branch.');
    await closePool();
    return;
  }

  const { bootstrapBranch, grantUserBranchAccess } = await import('@/lib/branch/bootstrap');
  const { ensureEmployeeBranchAssignment } = await import('@/lib/branch/assignmentIntegrity');
  const { evaluateBranchOperationalReadiness } = await import('@/lib/branch/readiness');
  const { branchNow } = await import('@/lib/branch/repository');

  const result = await bootstrapBranch({
    branch: {
      branchCode,
      branchName,
      shortName,
      address,
      phone,
      timeZone,
      businessDayCutoffTime: cutoff,
    },
    seedQueueSettings: { copyFromBranchCode: copySettingsFrom },
    seedPartnerSharesFrom,
  });

  console.log('  bootstrap result:');
  console.log(`    branchId: ${result.branch.branchId}`);
  console.log(`    branchCode: ${result.branch.branchCode}`);
  console.log(`    queueSettingsCreated: ${result.queueSettingsCreated}`);
  console.log(`    partnerSharesSeeded: ${result.partnerSharesSeeded}`);

  if (grantUserId != null) {
    const grant = await grantUserBranchAccess({
      userId: grantUserId,
      branchId: result.branch.branchId,
    });
    console.log(
      `  grantUserBranchAccess: created=${grant.created} reactivated=${grant.reactivated} accessId=${grant.accessId}`,
    );
  }

  if (assignEmpId != null) {
    const today = branchNow().toISOString().slice(0, 10);
    const assignment = await ensureEmployeeBranchAssignment({
      empId: assignEmpId,
      branchId: result.branch.branchId,
      effectiveFrom: today,
      canReceiveBookings: true,
    });
    console.log(
      `  ensureEmployeeBranchAssignment: created=${assignment.created} assignmentId=${assignment.assignmentId}`,
    );
  }

  if (printReadiness) {
    const readiness = await evaluateBranchOperationalReadiness({ branchId: result.branch.branchId });
    console.log('  readiness report:');
    console.log(JSON.stringify(readiness, null, 2));
  }

  await closePool();
  console.log('Phase 1G bootstrap complete.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
