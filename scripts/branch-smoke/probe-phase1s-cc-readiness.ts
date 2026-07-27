/**
 * Phase 1S — probe Camp Caesar readiness blockers (cloud).
 * Usage: npx tsx scripts/branch-smoke/probe-phase1s-cc-readiness.ts
 */
import path from 'path';
import Module from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
    /* optional */
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
  const { evaluateBranchReadiness } = await import('../../src/lib/branch/branchReadinessService');
  const { getBranchById } = await import('../../src/lib/branch/repository');
  const { getPool, sql } = await import('../../src/lib/db');

  const branch = await getBranchById(3);
  console.log('=== BRANCH 3 ===');
  console.log(
    JSON.stringify(
      {
        branchId: branch?.branchId,
        branchCode: branch?.branchCode,
        branchName: branch?.branchName,
        lifecycleStatus: branch?.lifecycleStatus,
        isActive: branch?.isActive,
        publicBookingEnabled: branch?.publicBookingEnabled,
        address: branch?.address,
        phone: branch?.phone,
        defaultOpenTime: branch?.defaultOpenTime,
        defaultCloseTime: branch?.defaultCloseTime,
      },
      null,
      2,
    ),
  );

  const r = await evaluateBranchReadiness(3);
  console.log('\n=== READINESS ===');
  console.log({
    score: r.score,
    isReadyForSmoke: r.isReadyForSmoke,
    isReadyForInternalLive: r.isReadyForInternalLive,
    isReadyForPublicLive: r.isReadyForPublicLive,
    blockerCount: r.blockers.length,
    warningCount: r.warnings.length,
  });

  console.log('\n=== INTERNAL_LIVE BLOCKERS ===');
  for (const b of r.blockers.filter((i) => i.requiredFor.includes('internal_live'))) {
    console.log(`- [${b.key}] ${b.title}: ${b.details}`);
  }

  console.log('\n=== PUBLIC_LIVE-ONLY BLOCKERS ===');
  for (const b of r.blockers.filter(
    (i) => i.requiredFor.includes('public_live') && !i.requiredFor.includes('internal_live'),
  )) {
    console.log(`- [${b.key}] ${b.title}: ${b.details}`);
  }

  const db = await getPool();
  const assigns = await db.request().input('bid', sql.Int, 3).query(`
    SELECT ea.EmpID, e.EmpName, ea.IsActive, ea.EffectiveFrom, ea.EffectiveTo
    FROM dbo.TblEmpBranchAssignment ea
    INNER JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
    WHERE ea.BranchID = @bid
    ORDER BY e.EmpName
  `);
  console.log('\n=== ASSIGNMENTS CC ===', assigns.recordset.length);
  for (const row of assigns.recordset.slice(0, 30)) {
    console.log(`  #${row.EmpID} ${row.EmpName} active=${row.IsActive}`);
  }

  const partners = await db.request().input('bid', sql.Int, 3).query(`
    SELECT PartnerName, SharePercent, IsActive, EffectiveFrom, Notes
    FROM dbo.TblBranchPartnerShare
    WHERE BranchID = @bid
    ORDER BY SharePercent DESC
  `);
  console.log('\n=== PARTNERS CC ===');
  for (const row of partners.recordset) {
    console.log(
      `  ${row.PartnerName} ${row.SharePercent}% active=${row.IsActive} from=${row.EffectiveFrom} notes=${String(row.Notes || '').slice(0, 60)}`,
    );
  }

  const policy = await db.request().input('bid', sql.Int, 3).query(`
    IF OBJECT_ID(N'dbo.TblBranchSetupPolicy', N'U') IS NULL
      SELECT 'NO_TABLE' AS State;
    ELSE
      SELECT * FROM dbo.TblBranchSetupPolicy WHERE BranchID = @bid;
  `);
  console.log('\n=== SETUP POLICY ===', JSON.stringify(policy.recordset[0] ?? null, null, 2));

  const smoke = await db.request().input('bid', sql.Int, 3).query(`
    IF OBJECT_ID(N'dbo.TblBranchSmokeRun', N'U') IS NULL
      SELECT 'NO_TABLE' AS State;
    ELSE
      SELECT TOP 5 SmokeRunID, Status, CleanupStatus, CreatedAt
      FROM dbo.TblBranchSmokeRun WHERE BranchID = @bid
      ORDER BY SmokeRunID DESC;
  `);
  console.log('\n=== SMOKE RUNS ===', smoke.recordset);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
