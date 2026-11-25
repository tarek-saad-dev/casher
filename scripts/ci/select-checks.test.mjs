import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GROUPS, selectChecks, readChangedPaths } from './select-checks.mjs';
import { REGRESSIONS, selectedFilters } from './run-regressions.mjs';

test('onboarding changes select provisioning dependencies but not printer agents or migrations', () => {
  const plan = selectChecks(['src/app/setup/page.tsx', 'src/platform/onboarding/selfServiceJourney.ts']);
  assert.equal(plan.mode, 'targeted');
  for (const group of ['onboarding', 'commercial', 'booking', 'queue', 'payroll', 'pos']) assert.ok(plan.groups.includes(group));
  for (const group of ['printing', 'migration', 'messaging']) assert.ok(!plan.groups.includes(group));
});

test('onboarding presentation changes only select onboarding and commercial', () => {
  assert.deepEqual(selectChecks(['src/components/onboarding/InlineSetupForm.tsx']).groups, ['onboarding', 'commercial']);
  assert.deepEqual(selectChecks(['src/app/setup/page.tsx']).groups, ['onboarding', 'commercial']);
});

test('payroll, booking and printing select their domain and downstream checks', () => {
  const payroll = selectChecks(['src/lib/payroll/payrollAgreementMath.ts']);
  assert.ok(payroll.groups.includes('payroll'));
  assert.ok(!payroll.groups.includes('printing'));
  const booking = selectChecks(['src/apps/booking/domain/example.ts']);
  assert.ok(booking.groups.includes('booking'));
  assert.ok(booking.groups.includes('queue'));
  assert.ok(!booking.groups.includes('printing'));
  assert.ok(selectChecks(['print-service/windows/run-agent.ps1']).groups.includes('printing'));
  assert.ok(selectChecks(['public/downloads/Check-CUT-Print-Agent.ps1']).groups.includes('printing'));
  assert.ok(selectChecks(['src/apps/pos/domain/example.ts']).groups.includes('printing'));
});

test('multiple paths union their dependencies, regardless of order', () => {
  const paths = ['src/platform/onboarding/foo.ts', 'print-service/index.js', 'src/platform/drvo/migration.ts'];
  assert.deepEqual(selectChecks(paths).groups, GROUPS);
  const mixed = ['src/platform/onboarding/foo.ts', 'src/modules/messaging/foo.ts'];
  assert.deepEqual(selectChecks(mixed).groups, selectChecks([...mixed].reverse()).groups);
  assert.ok(selectChecks(mixed).groups.includes('messaging'));
  assert.ok(selectChecks(mixed).groups.includes('onboarding'));
});

test('shared, config, migrations, auth, new paths and missing diffs fail closed', () => {
  for (const path of ['.github/workflows/ci.yml', 'scripts/ci/select-checks.mjs',
    'src/lib/db.ts', 'src/lib/api-auth.ts', 'src/lib/session.ts', 'src/components/layout/AuthenticatedAppShell.tsx',
    'package-lock.json', 'vitest.config.ts', 'src/lib/migrations/new.ts',
    'src/platform/tenant/tenantContext.ts', 'new-module/file.ts', 'docs/drvo/CONTROL-PLANE.md']) {
    assert.deepEqual(selectChecks([path]).groups, GROUPS, path);
  }
  assert.deepEqual(selectChecks([]).groups, GROUPS);
  assert.deepEqual(selectChecks(null).groups, GROUPS);
  assert.deepEqual(selectChecks(['README.md'], { full: true }).groups, GROUPS);
  assert.deepEqual(selectChecks(['README.md', 'docs/guide.md']).groups, []);
});

test('all group inventories are nonempty; filter selection deduplicates and rejects invalid groups', () => {
  assert.deepEqual(Object.keys(REGRESSIONS), GROUPS);
  for (const group of GROUPS) assert.ok(REGRESSIONS[group].length > 0, group);
  const full = selectedFilters(GROUPS, () => false);
  assert.equal(full.length, new Set(full).size);
  for (const group of GROUPS) for (const filter of REGRESSIONS[group]) assert.ok(full.includes(filter));
  assert.throws(() => selectedFilters(['typo']));
  assert.throws(() => selectedFilters(null));
  const changed = ['src/platform/__tests__/new.test.ts', 'src/lib/new.integration.test.ts', 'src/lib/deleted.test.ts'];
  const filters = selectedFilters(['onboarding'], p => !p.includes('deleted'), changed);
  assert.ok(filters.includes('src/platform/__tests__/new.test.ts'));
  assert.ok(filters.includes('src/platform/__tests__/selfServiceJourney.test.ts'));
  assert.ok(!filters.includes('src/lib/new.integration.test.ts'));
  assert.ok(!filters.includes('src/lib/deleted.test.ts'));
});

test('git comparison includes deletions, old and new rename paths and spaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'casher-ci-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'CI Test');
    git('config', 'user.email', 'ci@example.invalid');
    mkdirSync(join(dir, 'print-service'));
    writeFileSync(join(dir, 'print-service', 'old name.ps1'), 'hello');
    writeFileSync(join(dir, 'README.md'), 'old');
    git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    renameSync(join(dir, 'print-service', 'old name.ps1'), join(dir, 'new name.ps1'));
    unlinkSync(join(dir, 'README.md'));
    git('add', '-A'); git('commit', '-qm', 'change');
    assert.deepEqual(readChangedPaths(base, dir).sort(), ['README.md', 'new name.ps1', 'print-service/old name.ps1']);
    assert.throws(() => readChangedPaths('bad', dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
