#!/usr/bin/env npx tsx
/**
 * Phase 1M verifier — provisioning / readiness / lifecycle / public / smoke safety.
 * Static + optional live checks. Does NOT claim smoke PASS.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moduleWithLoad = Module as any;
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(this, request, ...rest);
};

const root = path.join(__dirname, '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}

function ok(msg: string) {
  console.log('OK:', msg);
}

function parseArgs(argv: string[]) {
  let expectedDatabase = 'last132';
  let mode = (process.env.AUDIT_DB_TARGET || 'cloud').toLowerCase();
  let skipLive = argv.includes('--skip-live');
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      expectedDatabase = arg.slice('--expected-database='.length).trim();
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length).trim().toLowerCase();
    }
  }
  return { expectedDatabase, mode, skipLive };
}

function buildConfig(mode: string): sql.config {
  if (mode === 'local') {
    return {
      server: process.env.LOCAL_DB_SERVER || process.env.DB_SERVER || '',
      port: parseInt(process.env.LOCAL_DB_PORT || process.env.DB_PORT || '1433', 10),
      database: process.env.LOCAL_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
      user: process.env.LOCAL_DB_USER || process.env.DB_USER || '',
      password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || '',
      options: { encrypt: process.env.LOCAL_DB_ENCRYPT === 'true', trustServerCertificate: true, enableArithAbort: true },
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

function staticChecks() {
  const migration = read('db/migrations/add-branch-lifecycle-phase-1m.sql');
  if (!migration.includes('LifecycleStatus')) fail('migration missing LifecycleStatus');
  if (!migration.includes('TblBranchSmokeRun')) fail('migration missing smoke run table');
  if (!migration.includes("BranchCode = N'PH1GTEST'")) fail('migration must pin PH1GTEST');

  const boot = read('src/lib/branch/bootstrap.ts');
  if (!boot.includes("lifecycleStatus = 'SETUP'")) fail('createBranchRecord must force SETUP');
  if (!boot.includes('const isActive = false')) fail('create must not default active');

  const provision = read('src/lib/branch/branchProvisioningService.ts');
  if (!provision.includes('rejectEscalationFields')) fail('provision must reject escalation');

  const transition = read('src/lib/branch/branchLifecycleTransition.ts');
  if (!transition.includes('evaluateBranchReadiness')) fail('transition must re-run readiness');
  if (!transition.includes('isForbiddenLifecycleJump')) fail('transition must block forbidden jumps');

  const publicOwn = read('src/lib/branch/bookingQueueOwnership.ts');
  if (!publicOwn.includes('isPubliclyDiscoverable')) fail('public list must use lifecycle gate');

  const smoke = read('src/lib/branch/branchSmokeService.ts');
  if (!smoke.includes('Cleanup يرفض BranchID الخاص بـ GLEEM')) fail('cleanup must refuse GLEEM');

  const cleanup = read('scripts/branch-smoke/cleanup-branch-smoke-run.ts');
  if (!cleanup.includes('Refuse') || !cleanup.includes('GLEEM')) fail('cleanup script must refuse GLEEM');

  const nightly = read('src/lib/hr/nightly-close.service.ts');
  if (!nightly.includes('listActiveBranches')) fail('nightly must still use listActiveBranches (IsActive)');

  ok('static source checks');
}

async function liveChecks(expectedDatabase: string, mode: string) {
  const cfg = buildConfig(mode);
  if (!cfg.server || !cfg.database) {
    console.warn('SKIP live: DB env incomplete');
    return;
  }
  const pool = await sql.connect(cfg);
  try {
    const dbName = (await pool.request().query('SELECT DB_NAME() AS n')).recordset[0].n;
    if (String(dbName).toLowerCase() !== expectedDatabase.toLowerCase()) {
      fail(`expected database ${expectedDatabase}, got ${dbName}`);
    }
    ok(`connected ${mode}/${dbName}`);

    const cols = await pool.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='TblBranch'
        AND COLUMN_NAME IN ('LifecycleStatus','PublicBookingEnabled','ExternalNotificationsEnabled')
    `);
    const names = new Set(cols.recordset.map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME));
    if (!names.has('LifecycleStatus')) fail('live missing LifecycleStatus — run migration');
    if (!names.has('PublicBookingEnabled')) fail('live missing PublicBookingEnabled');
    ok('lifecycle columns present');

    const ph = await pool.request().query(`
      SELECT BranchID, IsActive, LifecycleStatus, PublicBookingEnabled
      FROM dbo.TblBranch WHERE BranchCode = N'PH1GTEST'
    `);
    if (ph.recordset[0]) {
      const row = ph.recordset[0];
      if (Number(row.IsActive) === 1) fail('PH1GTEST must not be production-active');
      if (Number(row.PublicBookingEnabled) === 1) fail('PH1GTEST public booking must be off');
      if (String(row.LifecycleStatus) === 'PUBLIC_LIVE') fail('PH1GTEST must not be PUBLIC_LIVE');
      ok(`PH1GTEST safe (Lifecycle=${row.LifecycleStatus}, IsActive=${row.IsActive})`);
    } else {
      console.warn('PH1GTEST row not found (acceptable if not seeded)');
    }

    const gleem = await pool.request().query(`
      SELECT BranchID, IsActive, LifecycleStatus, PublicBookingEnabled
      FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
    `);
    if (!gleem.recordset[0]) fail('GLEEM missing');
    ok(`GLEEM Lifecycle=${gleem.recordset[0].LifecycleStatus}`);

    const smokeTables = await pool.request().query(`
      SELECT name FROM sys.tables WHERE name IN ('TblBranchSmokeRun','TblBranchSmokeArtifact','TblBranchLifecycleAudit')
    `);
    if (smokeTables.recordset.length < 3) fail('smoke/audit tables missing — run migration');
    ok('smoke + audit tables present');
  } finally {
    await pool.close();
  }
}

async function main() {
  const { expectedDatabase, mode, skipLive } = parseArgs(process.argv.slice(2));
  console.log('Phase 1M verifier');
  staticChecks();
  if (!skipLive) {
    await liveChecks(expectedDatabase, mode);
  } else {
    console.warn('SKIP live checks (--skip-live)');
  }
  console.log('VERDICT: source gates PASS; controlled smoke execution is NOT claimed PASS by this verifier.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
