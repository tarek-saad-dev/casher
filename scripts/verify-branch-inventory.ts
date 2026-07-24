#!/usr/bin/env npx tsx
/**
 * Phase 1J verifier — branch inventory + purchase ownership.
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
  let withPhase1i = false;
  let withPhase1h = false;
  let withPhase1g = false;
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      expectedDatabase = arg.slice('--expected-database='.length).trim();
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length).trim().toLowerCase();
    } else if (arg === '--with-phase1i') withPhase1i = true;
    else if (arg === '--with-phase1h') withPhase1h = true;
    else if (arg === '--with-phase1g') withPhase1g = true;
  }
  return { expectedDatabase, mode, withPhase1i, withPhase1h, withPhase1g };
}

function buildConfig(): sql.config {
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

function checkSource(failures: string[]) {
  console.log('  --- source ---');
  const required = [
    'db/migrations/add-branch-inventory-and-purchase-ownership.sql',
    'src/lib/inventory/inventoryMutation.service.ts',
    'src/lib/inventory/productTracking.ts',
    'src/lib/inventory/purchaseInventory.service.ts',
    'src/app/api/inventory/branch/route.ts',
    'src/app/api/purchases/route.ts',
    'docs/branch-phase-1j-closure.md',
  ];
  for (const f of required) {
    if (!exists(f)) failures.push(`missing ${f}`);
    else console.log(`    OK ${f}`);
  }

  const sales = read('src/app/api/sales/route.ts');
  if (!sales.includes('applySaleStockDecrements')) {
    failures.push('sales route missing stock decrement');
  }
  if (/UPDATE\s+\[?dbo\]?\.?\[?TblPro\]?[\s\S]{0,200}Qty\s*=/i.test(sales)) {
    failures.push('sales route writes TblPro.Qty');
  }

  const mut = read('src/lib/inventory/inventoryMutation.service.ts');
  if (!mut.includes('UPDLOCK') || !mut.includes('IdempotencyKey')) {
    failures.push('mutation service missing locking/idempotency');
  }
  if (/UPDATE\s+dbo\.TblPro/i.test(mut)) {
    failures.push('mutation service must not update TblPro');
  }

  const purch = read('src/app/api/purchases/route.ts');
  if (!purch.includes('BranchID في الطلب غير مسموح')) {
    failures.push('purchases must reject body BranchID');
  }
}

async function checkLive(mode: string, expectedDatabase: string, failures: string[]) {
  console.log('  --- live ---');
  const pool = await sql.connect(buildConfig());
  try {
    const dbName = (await pool.request().query(`SELECT DB_NAME() AS n`)).recordset[0].n;
    if (dbName !== expectedDatabase) {
      failures.push(`expected ${expectedDatabase}, got ${dbName}`);
      return;
    }
    console.log(`    OK database=${dbName}`);

    const active = await pool.request().query(`
      SELECT BranchCode FROM dbo.TblBranch WHERE IsActive = 1
    `);
    const codes = active.recordset.map((r: { BranchCode: string }) => r.BranchCode);
    if (codes.length !== 1 || codes[0] !== 'GLEEM') {
      failures.push(`expected only GLEEM active, got [${codes.join(',')}]`);
    } else console.log('    OK only GLEEM active');

    for (const table of ['TblBranchInventory', 'TblInventoryMovement', 'TblInventoryTransfer']) {
      const ex = await pool.request().query(`SELECT OBJECT_ID(N'dbo.${table}', N'U') AS id`);
      if (!ex.recordset[0].id) failures.push(`missing table ${table}`);
      else console.log(`    OK table ${table}`);
    }

    const uq = await pool.request().query(`
      SELECT COUNT(*) AS c FROM sys.indexes
      WHERE object_id = OBJECT_ID(N'dbo.TblBranchInventory')
        AND name = N'UQ_TblBranchInventory_Branch_Pro'
    `);
    if (uq.recordset[0].c !== 1) failures.push('missing UQ_TblBranchInventory_Branch_Pro');
    else console.log('    OK unique (BranchID, ProID)');

    const purchBranch = await pool.request().query(`
      SELECT is_nullable FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead') AND name = N'BranchID'
    `);
    if (!purchBranch.recordset[0] || purchBranch.recordset[0].is_nullable) {
      failures.push('TblinvPurchaseHead.BranchID must be NOT NULL');
    } else console.log('    OK purchase BranchID NOT NULL');

    const nullPurch = await pool.request().query(`
      SELECT COUNT(*) AS c FROM dbo.TblinvPurchaseHead WHERE BranchID IS NULL
    `);
    if (nullPurch.recordset[0].c > 0) {
      failures.push('null purchase BranchID rows');
    }

    const gleem = await pool.request().query(`
      SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
    `);
    const gleemId = gleem.recordset[0].BranchID;

    const bal = await pool.request().query(`
      SELECT
        SUM(CASE WHEN BranchID = ${gleemId} THEN 1 ELSE 0 END) AS gleemRows,
        SUM(CASE WHEN BranchID <> ${gleemId} THEN 1 ELSE 0 END) AS otherRows,
        SUM(CASE WHEN BranchID = ${gleemId} THEN QtyOnHand ELSE 0 END) AS gleemQty
      FROM dbo.TblBranchInventory
    `);
    const b = bal.recordset[0];
    if (Number(b.gleemRows) !== 8) {
      failures.push(`expected 8 GLEEM inventory rows, got ${b.gleemRows}`);
    } else console.log('    OK GLEEM inventory rows=8');
    if (Number(b.otherRows) !== 0) {
      failures.push(`PH1GTEST/other must have 0 inventory rows, got ${b.otherRows}`);
    } else console.log('    OK no non-GLEEM inventory rows');
    if (Number(b.gleemQty) !== 0) {
      failures.push(`GLEEM qty sum expected 0 (pre-migration), got ${b.gleemQty}`);
    } else console.log('    OK GLEEM qtySum=0 matches TblPro.Qty snapshot');

    // Balance vs latest movement (when movements exist)
    const drift = await pool.request().query(`
      SELECT COUNT(*) AS c
      FROM dbo.TblBranchInventory bi
      OUTER APPLY (
        SELECT TOP 1 m.QuantityAfter
        FROM dbo.TblInventoryMovement m
        WHERE m.BranchID = bi.BranchID AND m.ProID = bi.ProID
        ORDER BY m.MovementID DESC
      ) lastMov
      WHERE lastMov.QuantityAfter IS NOT NULL
        AND lastMov.QuantityAfter <> bi.QtyOnHand
    `);
    if (drift.recordset[0].c > 0) {
      failures.push(`balance/movement drift count=${drift.recordset[0].c}`);
    } else console.log('    OK no balance/movement drift');
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
  console.log('=== Phase 1J verify-branch-inventory ===');
  checkSource(failures);
  await checkLive(args.mode, args.expectedDatabase, failures);

  const child = [`--mode=${args.mode}`, `--expected-database=${args.expectedDatabase}`];
  if (args.withPhase1i) {
    spawnVerifier('scripts/verify-multibranch-boundaries.ts', [...child, '--with-phase1g', '--with-phase1h'], failures);
  } else {
    if (args.withPhase1g) spawnVerifier('scripts/verify-second-branch-readiness.ts', child, failures);
    if (args.withPhase1h) spawnVerifier('scripts/verify-branch-switcher.ts', [...child, '--with-phase1g'], failures);
  }

  if (failures.length) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
    console.log('\nPhase 1J verification FAILED');
    process.exit(1);
  }
  console.log('\nPhase 1J verification PASSED');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
