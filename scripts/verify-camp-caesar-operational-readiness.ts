#!/usr/bin/env npx tsx
/**
 * Phase 1N-B verifier — Camp Caesar operational readiness / isolation / proofs.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}
function ok(msg: string) {
  console.log('OK:', msg);
}

function parseArgs(argv: string[]) {
  let expectedDatabase = 'last132';
  let mode = 'cloud';
  for (const a of argv) {
    if (a.startsWith('--expected-database=')) expectedDatabase = a.split('=')[1];
    else if (a.startsWith('--mode=')) mode = a.split('=')[1];
  }
  return { expectedDatabase, mode };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.join(__dirname, '..');
  const readiness = fs.readFileSync(
    path.join(root, 'src/lib/branch/branchReadinessService.ts'),
    'utf8',
  );
  const policy = fs.readFileSync(
    path.join(root, 'src/lib/branch/smokeBranchPolicy.ts'),
    'utf8',
  );
  const smokeSvc = fs.readFileSync(
    path.join(root, 'src/lib/branch/branchSmokeService.ts'),
    'utf8',
  );
  const runner = fs.readFileSync(
    path.join(root, 'scripts/branch-smoke/run-phase1n-camp-caesar-smoke.ts'),
    'utf8',
  );

  if (!readiness.includes('smoke.service_price')) fail('missing smoke.service_price blocker');
  if (!readiness.includes('smoke.payment_method')) fail('missing smoke.payment_method');
  if (!readiness.includes('smoke.inventory_container')) fail('missing inventory container blocker');
  if (!readiness.includes('public.frontend_multi_branch')) {
    fail('missing public frontend gate');
  }
  if (!readiness.includes('publicBlockers')) {
    fail('public.frontend_multi_branch must be blocker for PUBLIC_LIVE (publicBlockers)');
  }
  if (!readiness.includes("requiredFor: ['public_live']")) {
    fail('public_live requiredFor missing');
  }
  if (!policy.includes('CAMP_CAESAR')) fail('policy missing CAMP_CAESAR');
  if (!policy.includes('INTERNAL_LIVE_SMOKE_PROOF_KEYS')) fail('missing proof keys');
  if (!smokeSvc.includes('isAllowedSmokeBranchCode')) fail('smoke service not generalized');
  if (runner.includes('allowInactive')) fail('runner must not use allowInactive');
  if (!runner.includes('applyManualStockAdjustment')) fail('runner missing inventory adj');
  if (!runner.includes('TblinvServHead')) fail('runner missing real POS invoice');
  if (!runner.includes('runDailyPayrollGenerateWithOptionalLedger')) {
    fail('runner missing hourly ledger dual-write path');
  }
  if (!runner.includes('dryRun: false')) fail('runner missing actual monthly post');
  if (!runner.includes('BranchID=1') && !runner.includes('branchId: 1')) {
    fail('runner should test GLEEM rejection');
  }
  ok('static source gates');

  if (args.mode !== 'cloud' || args.expectedDatabase !== 'last132') {
    fail('verifier targets cloud/last132 only');
  }

  const dbName = process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '';
  if (dbName !== args.expectedDatabase) {
    fail(`DB ${dbName} != ${args.expectedDatabase}`);
  }
  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || '1433', 10),
    database: dbName,
    user: process.env.CLOUD_DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || '',
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  });
  ok(`connected ${args.mode}/${args.expectedDatabase}`);

  const cc = await pool.request().query(`
    SELECT BranchID, BranchCode, LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
    FROM dbo.TblBranch WHERE BranchCode=N'CAMP_CAESAR'
  `);
  const row = cc.recordset[0];
  if (!row) fail('CAMP_CAESAR missing');
  if (Number(row.BranchID) !== 3) fail('CAMP_CAESAR BranchID must be 3');
  if (Boolean(row.PublicBookingEnabled)) fail('Camp Caesar PublicBookingEnabled=1');
  if (String(row.LifecycleStatus) === 'PUBLIC_LIVE') {
    fail('Camp Caesar must not be PUBLIC_LIVE');
  }
  if (String(row.LifecycleStatus) === 'INTERNAL_LIVE') {
    if (!Boolean(row.IsActive)) fail('INTERNAL_LIVE requires IsActive=1');
    ok(`Camp Caesar INTERNAL_LIVE: IsActive=1 Public=0`);
  } else {
    if (Boolean(row.IsActive)) fail('Camp Caesar IsActive=1 before INTERNAL_LIVE');
    ok(`Camp Caesar safe: Lifecycle=${row.LifecycleStatus} IsActive=0 Public=0`);
  }

  const active = await pool.request().query(`
    SELECT BranchCode FROM dbo.TblBranch WHERE IsActive=1
  `);
  const ccActive = active.recordset.some((r: { BranchCode: string }) => r.BranchCode === 'CAMP_CAESAR');
  if (String(row.LifecycleStatus) === 'INTERNAL_LIVE') {
    if (!ccActive) fail('INTERNAL_LIVE Camp Caesar missing from active/nightly enumeration');
    ok('included in active/nightly list (INTERNAL_LIVE)');
  } else {
    if (ccActive) fail('Camp Caesar in nightly/active enumeration');
    ok('excluded from active/nightly list');
  }

  // Nested verifiers
  const { spawnSync } = await import('child_process');
  for (const script of [
    'scripts/verify-branch-provisioning-readiness-smoke.ts',
    'scripts/verify-employee-financial-branch-ownership.ts',
  ]) {
    const r = spawnSync(
      'npx',
      ['tsx', script, '--mode=cloud', '--expected-database=last132'],
      { cwd: root, encoding: 'utf8', shell: true },
    );
    if (r.status !== 0) {
      console.error(r.stdout);
      console.error(r.stderr);
      fail(`nested verifier failed: ${script}`);
    }
    ok(`nested ${path.basename(script)}`);
  }

  await pool.close();
  console.log('VERDICT: Camp Caesar operational verifier PASS (static+live safety; smoke PASS is evidence-based separately)');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
