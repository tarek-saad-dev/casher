#!/usr/bin/env npx tsx
/**
 * Phase 1H verifier — secure active-branch session switcher.
 *
 * Combines static source-contract checks (route wiring, CanOperate gating,
 * no IsDefault mutation, client hard-navigation, no soft router.refresh())
 * with a small set of live cloud checks (GLEEM is the only active
 * production branch, PH1GTEST stays inactive, no HR BranchID columns).
 *
 * This verifier does NOT reactivate PH1GTEST and does NOT perform a live
 * smoke switch — Phase 1H intentionally skips a live smoke test because
 * there is no second *active* production branch to switch into. Infra is
 * covered by unit tests (phase1hBranchSwitcher.test.ts) + these checks.
 *
 * Exit codes: 0 = PASS, 1 = FAIL.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));

function parseArgs(argv: string[]) {
  let expectedDatabase = 'last132';
  let mode = (process.env.AUDIT_DB_TARGET || 'cloud').toLowerCase();
  let skipLive = false;
  let spawnPhase1g = false;
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      expectedDatabase = arg.slice('--expected-database='.length).trim();
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length).trim().toLowerCase();
    } else if (arg === '--skip-live') {
      skipLive = true;
    } else if (arg === '--with-phase1g') {
      spawnPhase1g = true;
    }
  }
  return { expectedDatabase, mode, skipLive, spawnPhase1g };
}

function buildConfig(mode: string): sql.config {
  if (mode === 'local') {
    return {
      server: process.env.LOCAL_DB_SERVER || process.env.DB_SERVER || '',
      port: parseInt(process.env.LOCAL_DB_PORT || process.env.DB_PORT || '1433', 10),
      database: process.env.LOCAL_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
      user: process.env.LOCAL_DB_USER || process.env.DB_USER || '',
      password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || '',
      options: {
        encrypt: process.env.LOCAL_DB_ENCRYPT === 'true',
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      requestTimeout: 180000,
    };
  }
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 180000,
  };
}

const FORBIDDEN_HR_TABLES = [
  // Phase 1K owns attendance BranchID; payroll/ledger/target/budget stay deferred.
  'TblEmpPayroll',
  'TblEmpTarget',
  'TblEmpLedgerEntry',
  'TblBudget',
];

function checkSourceContracts(failures: string[]) {
  console.log('  --- source contracts ---');

  // 1. Routes exist and use switchBranch module functions
  const requiredFiles = [
    'src/app/api/auth/switch-branch/route.ts',
    'src/app/api/auth/branches/route.ts',
    'src/lib/branch/switchBranch.ts',
    'src/lib/branch/postSwitchNavigation.ts',
    'src/lib/branch/postSwitchClient.ts',
    'src/components/session/BranchSwitcher.tsx',
  ];
  for (const f of requiredFiles) {
    const ok = exists(f);
    console.log(`  file exists: ${f} -> ${ok}`);
    if (!ok) failures.push(`missing required file: ${f}`);
  }
  if (failures.some((f) => f.startsWith('missing required file'))) return;

  const switchRoute = read('src/app/api/auth/switch-branch/route.ts');
  if (!switchRoute.includes("from '@/lib/branch/switchBranch'") || !/switchActiveBranch\(/.test(switchRoute)) {
    failures.push('switch-branch route does not call switchActiveBranch() from @/lib/branch/switchBranch');
  }
  // Session cookie mutation only via createSession/setSessionCookie inside switchActiveBranch —
  // the Route Handler itself must not import session cookie mutators directly.
  if (/from ['"]@\/lib\/session['"]/.test(switchRoute)) {
    failures.push('switch-branch route imports @/lib/session directly — cookie mutation must stay inside switchActiveBranch');
  }

  const branchesRoute = read('src/app/api/auth/branches/route.ts');
  if (!branchesRoute.includes("from '@/lib/branch/switchBranch'") || !/listSwitchableBranchesForUser\(/.test(branchesRoute)) {
    failures.push('branches route does not call listSwitchableBranchesForUser()');
  }

  // 2. switchBranch.ts requires CanOperate, never touches IsDefault, never imports the DB layer directly
  const switchSrc = read('src/lib/branch/switchBranch.ts');
  if (!/if\s*\(!access\.canOperate\)/.test(switchSrc)) {
    failures.push('switchBranch.ts does not gate on access.canOperate');
  }
  if (/UserLevel\s*===\s*['"]admin['"][\s\S]{0,120}canOperate/.test(switchSrc)) {
    failures.push('switchBranch.ts appears to bypass CanOperate for admin UserLevel');
  }
  if (/from ['"]@\/lib\/db['"]/.test(switchSrc) || /getPool\(/.test(switchSrc) || /\.query\(/.test(switchSrc)) {
    failures.push('switchBranch.ts imports the DB layer directly — it must only read via ./repository and ./access');
  }
  if (/SET\s+IsDefault/i.test(switchSrc)) {
    failures.push('switchBranch.ts contains a SQL SET IsDefault — must never mutate IsDefault');
  }
  if (!switchSrc.includes('createSession(')) {
    failures.push('switchBranch.ts does not reissue the session via createSession()');
  }
  if (!switchSrc.includes('writeSensitiveAuditEvent')) {
    failures.push('switchBranch.ts does not audit via writeSensitiveAuditEvent');
  }

  // 3. BranchSwitcher uses performBranchSwitch; postSwitchClient hard-navigates via location.assign
  const switcherSrc = read('src/components/session/BranchSwitcher.tsx');
  if (!switcherSrc.includes('performBranchSwitch')) {
    failures.push('BranchSwitcher.tsx does not use performBranchSwitch()');
  }
  if (/useRouter/.test(switcherSrc)) {
    failures.push('BranchSwitcher.tsx imports useRouter — post-switch flow must not rely on client-router refresh');
  }

  const clientSrc = read('src/lib/branch/postSwitchClient.ts');
  if (!clientSrc.includes('window.location.assign')) {
    failures.push('postSwitchClient.ts does not perform a hard navigation via window.location.assign');
  }
  if (/useRouter/.test(clientSrc)) {
    failures.push('postSwitchClient.ts imports useRouter — must rely solely on window.location.assign');
  }

  // 4. Sensitive action registry
  const registrySrc = read('src/lib/sensitiveActionRegistry.ts');
  if (!registrySrc.includes('BRANCH_SESSION_SWITCH:') || !registrySrc.includes('BRANCH_SESSION_SWITCH_DENIED:')) {
    failures.push('sensitiveActionRegistry.ts is missing BRANCH_SESSION_SWITCH / BRANCH_SESSION_SWITCH_DENIED');
  }

  // 5. Barrel re-exports
  const indexSrc = read('src/lib/branch/index.ts');
  for (const name of ['listSwitchableBranchesForUser', 'switchActiveBranch', 'resolvePostSwitchNavigationPath']) {
    if (!indexSrc.includes(name)) failures.push(`src/lib/branch/index.ts does not re-export ${name}`);
  }
}

async function checkLive(mode: string, expectedDatabase: string, failures: string[], warnings: string[]) {
  console.log('  --- live checks ---');
  const config = buildConfig(mode);
  console.log(`  selected mode: ${mode}`);
  console.log(`  database: ${config.database}`);

  if (config.database !== expectedDatabase) {
    failures.push(`database mismatch: ${config.database} != ${expectedDatabase}`);
    return;
  }

  const pool = await sql.connect(config);
  try {
    // GLEEM must remain the only active production branch — Phase 1H does
    // not activate a second branch, so the switcher UI degrades to a
    // label-only display (branches.length <= 1) until one exists.
    const activeBranches = await pool.request().query(`
      SELECT BranchID, BranchCode, IsActive FROM dbo.TblBranch WHERE IsActive = 1 ORDER BY BranchCode
    `);
    const codes = activeBranches.recordset.map((r: { BranchCode: string }) => r.BranchCode);
    console.log(`  active branches: ${codes.join(', ') || '(none)'}`);
    if (activeBranches.recordset.length !== 1 || codes[0] !== 'GLEEM') {
      failures.push(`expected exactly one active branch (GLEEM); got: ${codes.join(', ') || '(none)'}`);
    }

    const ph1gtest = await pool.request().query(`
      SELECT BranchID, IsActive FROM dbo.TblBranch WHERE BranchCode = N'PH1GTEST'
    `);
    if (ph1gtest.recordset.length) {
      const isActive = Boolean(ph1gtest.recordset[0].IsActive);
      console.log(`  PH1GTEST IsActive: ${isActive}`);
      if (isActive) {
        failures.push('PH1GTEST is active — Phase 1G/1H require it to stay deactivated');
      }
    } else {
      console.log('  PH1GTEST: (not present)');
    }

    // No HR/payroll/ledger/target/budget tables may gain a BranchID column.
    const hrCols = await pool.request().query(`
      SELECT t.name AS TableName, c.name AS ColumnName
      FROM sys.columns c
      INNER JOIN sys.tables t ON t.object_id = c.object_id
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE c.name = N'BranchID' AND s.name = N'dbo'
        AND t.name IN (${FORBIDDEN_HR_TABLES.map((n) => `N'${n}'`).join(', ')})
    `);
    if (hrCols.recordset.length) {
      failures.push(
        `forbidden HR BranchID columns present: ${hrCols.recordset
          .map((r: { TableName: string }) => r.TableName)
          .join(', ')}`,
      );
    } else {
      console.log('  HR tables without BranchID: confirmed');
    }
  } finally {
    await pool.close();
  }
}

async function main() {
  const { expectedDatabase, mode, skipLive, spawnPhase1g } = parseArgs(process.argv.slice(2));

  console.log('Phase 1H branch-switcher verifier');

  const failures: string[] = [];
  const warnings: string[] = [];

  checkSourceContracts(failures);

  if (!skipLive) {
    try {
      await checkLive(mode, expectedDatabase, failures, warnings);
    } catch (err) {
      failures.push(`live check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    warnings.push('live checks skipped (--skip-live)');
  }

  if (spawnPhase1g) {
    console.log('  --- spawning Phase 1G verifier ---');
    const result = spawnSync(
      'npx',
      [
        'tsx',
        path.join(root, 'scripts/verify-second-branch-readiness.ts'),
        `--mode=${mode}`,
        `--expected-database=${expectedDatabase}`,
      ],
      { stdio: 'inherit', shell: process.platform === 'win32' },
    );
    if (result.status !== 0) {
      failures.push('Phase 1G verifier (verify-second-branch-readiness.ts) failed');
    }
  } else {
    console.log('  (Phase 1G verifier not spawned — pass --with-phase1g to include it)');
  }

  if (warnings.length) {
    console.warn('Warnings:');
    for (const w of warnings) console.warn(`  - ${w}`);
  }

  if (failures.length) {
    console.error('Phase 1H verification FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('Phase 1H verification PASSED');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
