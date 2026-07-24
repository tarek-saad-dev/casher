#!/usr/bin/env npx tsx
/**
 * Phase 1I verifier — fail on unresolved critical boundary issues.
 *
 * Exit 0 = PASS (may still report CONDITIONAL GO blockers as warnings),
 * Exit 1 = FAIL (route/source contract breach or live invariant broken).
 *
 * Go-live blockers for activating branch #2 are reported but do NOT fail
 * this verifier by themselves (infrastructure can be proven while blockers remain).
 * Pass --fail-on-blockers to treat them as hard failures.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import sql from 'mssql';
import {
  BRANCH_OWNED_ROUTE_MARKERS,
  DOMAIN_OWNERSHIP_REGISTRY,
  GO_LIVE_BLOCKER_DOMAINS,
} from '../src/lib/branch/domainOwnershipRegistry';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));

function parseArgs(argv: string[]) {
  let expectedDatabase = 'last132';
  let mode = (process.env.AUDIT_DB_TARGET || 'cloud').toLowerCase();
  let skipLive = false;
  let withPhase1g = false;
  let withPhase1h = false;
  let failOnBlockers = false;
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) expectedDatabase = arg.slice('--expected-database='.length).trim();
    else if (arg.startsWith('--mode=')) mode = arg.slice('--mode='.length).trim().toLowerCase();
    else if (arg === '--skip-live') skipLive = true;
    else if (arg === '--with-phase1g') withPhase1g = true;
    else if (arg === '--with-phase1h') withPhase1h = true;
    else if (arg === '--fail-on-blockers') failOnBlockers = true;
  }
  return { expectedDatabase, mode, skipLive, withPhase1g, withPhase1h, failOnBlockers };
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

const FORBIDDEN_HR_BRANCH_TABLES = [
  'TblEmpPayroll',
  'TblEmpTarget',
  'TblEmpLedgerEntry',
];

function checkSource(failures: string[]) {
  console.log('  --- source contracts ---');

  const requiredDocs = [
    'docs/branch-phase-1i-feature-inventory.md',
    'docs/branch-phase-1i-database-ownership-matrix.md',
    'docs/branch-phase-1i-shared-vs-owned-contract.md',
    'docs/branch-phase-1i-inventory-and-assets.md',
    'docs/branch-phase-1i-hr-payroll-boundary.md',
    'docs/branch-phase-1i-settings-and-jobs.md',
    'docs/branch-phase-1i-risk-register.md',
    'docs/branch-phase-1i-verification.md',
    'docs/branch-phase-1i-closure.md',
    'src/lib/branch/domainOwnershipRegistry.ts',
  ];
  for (const d of requiredDocs) {
    if (!exists(d)) failures.push(`missing required artifact: ${d}`);
    else console.log(`    OK ${d}`);
  }

  if (DOMAIN_OWNERSHIP_REGISTRY.length < 10) {
    failures.push('domain ownership registry too small');
  } else {
    console.log(`    OK registry entries=${DOMAIN_OWNERSHIP_REGISTRY.length}`);
  }

  for (const m of BRANCH_OWNED_ROUTE_MARKERS) {
    if (!exists(m.path)) {
      failures.push(`missing route file: ${m.path}`);
      continue;
    }
    const src = read(m.path);
    if (!src.includes(m.mustContain)) {
      failures.push(`${m.path} missing required marker: ${m.mustContain}`);
    } else {
      console.log(`    OK ${m.path}`);
    }
  }

  // Unscoped open-day antipattern must not remain in fixed routes
  const antiPatterns: Array<{ path: string; bad: RegExp; label: string }> = [
    {
      path: 'src/app/api/operations/status/route.ts',
      bad: /FROM \[dbo\]\.\[TblNewDay\]\s+WHERE Status = 1\s+ORDER BY/i,
      label: 'unscoped open day',
    },
    {
      path: 'src/app/api/day/rollover-check/route.ts',
      bad: /FROM \[dbo\]\.\[TblNewDay\]\s+WHERE Status = 1\s+ORDER BY/i,
      label: 'unscoped open day',
    },
    {
      path: 'src/app/api/queue/settings/route.ts',
      bad: /SELECT TOP 1 \* FROM \[dbo\]\.\[QueueBookingSettings\] ORDER BY/i,
      label: 'unscoped queue settings TOP 1',
    },
    {
      path: 'src/lib/hr/owner-daily-whatsapp-report.service.ts',
      bad: /getBranchByCode\('GLEEM'\)/,
      label: 'owner WA prefers GLEEM',
    },
  ];
  for (const a of antiPatterns) {
    if (!exists(a.path)) continue;
    if (a.bad.test(read(a.path))) failures.push(`${a.path} still has ${a.label}`);
    else console.log(`    OK no ${a.label} in ${a.path}`);
  }

  // Sales WhatsApp must pass branchName from session branch
  const sales = read('src/app/api/sales/route.ts');
  if (!sales.includes('branchName: gated.branch.branchName')) {
    failures.push('sales route missing branchName from gated.branch');
  } else {
    console.log('    OK sales WhatsApp branchName from session branch');
  }
}

async function checkLive(
  mode: string,
  expectedDatabase: string,
  failures: string[],
  warnings: string[],
) {
  console.log('  --- live database ---');
  const pool = await sql.connect(buildConfig(mode));
  try {
    const dbName = (await pool.request().query(`SELECT DB_NAME() AS n`)).recordset[0].n;
    if (dbName !== expectedDatabase) {
      failures.push(`expected database ${expectedDatabase}, got ${dbName}`);
      return;
    }
    console.log(`    OK database=${dbName}`);

    const active = await pool.request().query(`
      SELECT BranchCode FROM dbo.TblBranch WHERE IsActive = 1 ORDER BY BranchID
    `);
    const codes = active.recordset.map((r: { BranchCode: string }) => r.BranchCode);
    if (codes.length !== 1 || codes[0] !== 'GLEEM') {
      failures.push(`expected only active GLEEM, got [${codes.join(',')}]`);
    } else {
      console.log('    OK only active production branch = GLEEM');
    }

    const ph1g = await pool.request().query(`
      SELECT BranchID, IsActive FROM dbo.TblBranch WHERE BranchCode = N'PH1GTEST'
    `);
    if (ph1g.recordset.length === 0) {
      warnings.push('PH1GTEST not present (ok if never created on this DB)');
    } else if (ph1g.recordset[0].IsActive) {
      failures.push('PH1GTEST must remain inactive');
    } else {
      console.log('    OK PH1GTEST inactive');
    }

    for (const table of FORBIDDEN_HR_BRANCH_TABLES) {
      const col = await pool
        .request()
        .input('t', sql.NVarChar, table)
        .query(`
          SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @t AND COLUMN_NAME = N'BranchID'
        `);
      if (col.recordset[0].c > 0) {
        failures.push(`${table}.BranchID must not exist until business decision (Phase 1I freeze)`);
      } else {
        console.log(`    OK no BranchID on ${table}`);
      }
    }

    const requiredBranchTables = [
      'TblNewDay',
      'TblShiftMove',
      'TblinvServHead',
      'TblCashMove',
      'Bookings',
      'QueueTickets',
      'QueueBookingSettings',
    ];
    for (const table of requiredBranchTables) {
      const nulls = await pool.request().query(`
        SELECT COUNT(*) AS c FROM dbo.[${table}] WHERE BranchID IS NULL
      `);
      if (nulls.recordset[0].c > 0) {
        failures.push(`${table} has ${nulls.recordset[0].c} NULL BranchID rows`);
      } else {
        console.log(`    OK ${table} BranchID nulls=0`);
      }
    }

    const purchaseBranch = await pool.request().query(`
      SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME='TblinvPurchaseHead' AND COLUMN_NAME='BranchID'
    `);
    if (purchaseBranch.recordset[0].c === 0) {
      failures.push('TblinvPurchaseHead.BranchID missing after Phase 1J');
    } else {
      console.log('    OK purchase BranchID present (Phase 1J)');
    }
  } finally {
    await pool.close();
  }
}

function spawnVerifier(scriptRel: string, args: string[], failures: string[]) {
  console.log(`  --- spawn ${scriptRel} ---`);
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', scriptRel, ...args],
    { cwd: root, encoding: 'utf8', shell: true },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) failures.push(`${scriptRel} exited ${r.status}`);
  else console.log(`    OK ${scriptRel}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const failures: string[] = [];
  const warnings: string[] = [];

  console.log('=== Phase 1I verify-multibranch-boundaries ===');
  checkSource(failures);

  if (!args.skipLive) {
    await checkLive(args.mode, args.expectedDatabase, failures, warnings);
  } else {
    console.log('  --- live skipped ---');
  }

  const childArgs = [`--mode=${args.mode}`, `--expected-database=${args.expectedDatabase}`];
  if (args.withPhase1g) {
    spawnVerifier('scripts/verify-second-branch-readiness.ts', childArgs, failures);
  }
  if (args.withPhase1h) {
    spawnVerifier('scripts/verify-branch-switcher.ts', [...childArgs, '--with-phase1g'], failures);
  }

  console.log('\n--- go-live blockers (documented) ---');
  for (const d of GO_LIVE_BLOCKER_DOMAINS) {
    console.log(`  BLOCKER: ${d}`);
    warnings.push(`go-live blocker domain: ${d}`);
  }
  if (args.failOnBlockers && GO_LIVE_BLOCKER_DOMAINS.length > 0) {
    failures.push(`--fail-on-blockers set and blockers remain: ${GO_LIVE_BLOCKER_DOMAINS.join(',')}`);
  }

  if (warnings.length) {
    console.log('\nWarnings:');
    for (const w of warnings) console.log(`  - ${w}`);
  }

  if (failures.length) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
    console.log('\nPhase 1I verification FAILED');
    process.exit(1);
  }

  console.log('\nPhase 1I verification PASSED (CONDITIONAL GO — blockers documented)');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
