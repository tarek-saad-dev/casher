#!/usr/bin/env npx tsx
/**
 * Phase 1S — Camp Caesar INTERNAL_LIVE go-live verifier (static + live readiness flags).
 */
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}
function ok(msg: string) {
  console.log('OK:', msg);
}

const root = path.join(__dirname, '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function exists(rel: string) {
  return fs.existsSync(path.join(root, rel));
}

async function main() {
  const required = [
    'src/lib/branch/launchRosterService.ts',
    'src/app/admin/branches/[id]/setup/employees/page.tsx',
    'src/app/admin/branches/[id]/setup/payroll-targets/page.tsx',
    'src/app/api/admin/branches/[id]/setup/employees/route.ts',
    'src/app/api/admin/employees/[id]/schedule/route.ts',
    'scripts/branch-smoke/run-phase1s-1r-live-transfer-smoke.ts',
    'scripts/branch-smoke/run-phase1s-r-final-current-config-smoke.ts',
    'scripts/branch-smoke/activate-phase1s-internal-live.ts',
  ];
  for (const f of required) {
    if (!exists(f)) fail(`missing ${f}`);
  }
  ok('required Phase 1S files');

  const readiness = read('src/lib/branch/branchReadinessService.ts');
  if (!readiness.includes('ops.weekly_employee_coverage')) {
    fail('weekly employee coverage readiness key missing');
  }
  if (!readiness.includes('final.current_config_smoke')) {
    fail('final.current_config_smoke readiness key missing');
  }
  if (!readiness.includes('services.catalog_operational')) {
    fail('services.catalog_operational readiness key missing');
  }
  if (!readiness.includes('retainedFromSmokeRunId')) {
    fail('retained-only smoke rejection missing');
  }
  ok('readiness policy keys (coverage/catalog/current-config)');

  const docSet = [
    'docs/branch-phase-1s-closure.md',
    'docs/branch-phase-1s-final-smoke.md',
    'docs/branch-phase-1s-internal-live-readiness.md',
    'docs/branch-phase-1s-internal-live-transition.md',
    'docs/branch-phase-1s-phase1r-live-smoke.md',
    'docs/branch-phase-1s-post-activation-verification.md',
    'docs/branch-phase-1s-real-employee-setup.md',
    'docs/branch-phase-1s-verification.md',
  ];
  for (const rel of docSet) {
    if (!exists(rel)) fail(`missing ${rel}`);
    const body = read(rel);
    // Strip SUPERSEDED sections before stale-phrase checks
    const activeBody = body.replace(/## SUPERSEDED[\s\S]*?(?=\n## )/g, '\n');
    const stale =
      /(^|\n)## Status\s*\n+\s*\*\*NOT RUN\*\*/i.test(activeBody) ||
      (/branch still SETUP/i.test(activeBody) && !/INTERNAL_LIVE/i.test(activeBody)) ||
      (/^## Status\s*\n+\s*\*\*Not executed\*\*/im.test(activeBody) ||
        (/Not executed in this delivery/i.test(activeBody) && !/SUPERSEDED|Executed path/i.test(body))) ||
      (/Only inactive smoke\/test assignments on CC — \*\*no real operational employees\*\*/i.test(
        activeBody,
      ));
    if (stale) fail(`${rel} still has stale NOT RUN / SETUP claims`);
  }
  const closure = read('docs/branch-phase-1s-closure.md');
  if (!/INTERNAL_LIVE/.test(closure)) fail('closure must state INTERNAL_LIVE');
  if (!closure.includes('22')) {
    fail('closure must cite SmokeRun 22 as authoritative final smoke');
  }
  if (!closure.includes('16')) fail('closure must cite SmokeRun 16');
  if (!/Weekly employee coverage[\s\S]*?\*\*NO-GO\*\*/i.test(closure)) {
    fail('closure must mark weekly coverage NO-GO');
  }
  const finalSmoke = read('docs/branch-phase-1s-final-smoke.md');
  if (!finalSmoke.includes('22') || !/Final current-config smoke: GO/i.test(finalSmoke)) {
    fail('final-smoke doc must report SmokeRun 22 GO');
  }
  ok('Phase 1S docs consistent with INTERNAL_LIVE + SmokeRun 16/22');

  const schedule = read('src/app/api/admin/employees/[id]/schedule/route.ts');
  if (!schedule.includes('LEGACY_EMP_WORK_SCHEDULE_WRITE_LOCKED')) {
    fail('legacy schedule write lock missing');
  }
  ok('legacy schedule write lock');

  const employeesPage = read('src/app/admin/branches/[id]/setup/employees/page.tsx');
  if (!employeesPage.includes('تجهيز فريق افتتاح كامب شيزار')) {
    fail('launch roster title missing');
  }
  if (!employeesPage.includes('حفظ التعيين الذري')) fail('atomic commit CTA missing');
  ok('launch roster UI');

  const payrollPage = read('src/app/admin/branches/[id]/setup/payroll-targets/page.tsx');
  if (!payrollPage.includes('لوحة تغطية الرواتب والتارجت')) fail('coverage dashboard missing');
  ok('payroll coverage dashboard');

  if (!readiness.includes('ELIGIBLE_BARBER') || !readiness.includes('bookable assignment')) {
    fail('ELIGIBLE_BARBER SETUP pre-live path missing');
  }
  ok('ELIGIBLE_BARBER pre-live readiness');

  const activation = path.join(root, 'scripts/branch-smoke/_phase1s-activation-result.json');
  if (exists('scripts/branch-smoke/_phase1s-activation-result.json')) {
    const act = JSON.parse(fs.readFileSync(activation, 'utf8'));
    if (act.finalFlags?.lifecycleStatus !== 'INTERNAL_LIVE') {
      fail('activation result not INTERNAL_LIVE');
    }
    if (act.finalFlags?.publicBookingEnabled) fail('public booking enabled');
    if (!act.postActivation?.inActiveBranches) fail('not in active branches');
    if (act.postActivation?.inPublicActiveBranches) fail('still in public branches');
    ok('activation artifact INTERNAL_LIVE');
  } else {
    console.log('WARN: activation artifact not present yet (run activate script first)');
  }

  const nested = [
    'scripts/verify-employee-schedule-operations-integration.ts',
    'scripts/verify-cross-branch-employee-scheduling-booking.ts',
    'scripts/verify-camp-caesar-real-configuration.ts',
    'scripts/verify-camp-caesar-operational-readiness.ts',
  ];
  for (const script of nested) {
    const r = spawnSync('npx', ['tsx', script], {
      cwd: root,
      encoding: 'utf8',
      shell: true,
    });
    if (r.status !== 0) {
      console.error(r.stdout);
      console.error(r.stderr);
      fail(`${script} failed`);
    }
    ok(script);
  }

  console.log('\nverify-camp-caesar-internal-go-live PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
