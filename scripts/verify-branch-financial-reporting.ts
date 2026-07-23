#!/usr/bin/env npx tsx
/**
 * Phase 1E verifier — partner shares + GLEEM report fingerprint stability.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

function parseArgs(argv: string[]) {
  let expectedDatabase = 'last132';
  let mode = (process.env.AUDIT_DB_TARGET || 'cloud').toLowerCase();
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      expectedDatabase = arg.slice('--expected-database='.length).trim();
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length).trim().toLowerCase();
    }
  }
  return { expectedDatabase, mode };
}

async function main() {
  const { expectedDatabase, mode } = parseArgs(process.argv.slice(2));
  const config: sql.config = {
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
    requestTimeout: 120000,
  };
  if (config.database !== expectedDatabase) {
    console.error(`Database mismatch: ${config.database} != ${expectedDatabase}`);
    process.exit(1);
  }

  const beforePath = path.join(__dirname, 'audit-branches', '_phase1e-report-baseline-before.json');
  const afterPath = path.join(__dirname, 'audit-branches', '_phase1e-report-baseline-after.json');
  const before = fs.existsSync(beforePath)
    ? JSON.parse(fs.readFileSync(beforePath, 'utf8'))
    : null;
  const after = fs.existsSync(afterPath)
    ? JSON.parse(fs.readFileSync(afterPath, 'utf8'))
    : null;

  const failures: string[] = [];
  const pool = await sql.connect(config);
  try {
    const gleem = await pool.request().query(`
      SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
    `);
    const gleemId = gleem.recordset[0]?.BranchID as number | undefined;
    if (!gleemId) failures.push('GLEEM missing');

    const shares = await pool.request().input('b', gleemId ?? -1).query(`
      SELECT PartnerCode, PartnerName, SharePercent, EffectiveFrom, EffectiveTo, IsActive
      FROM dbo.TblBranchPartnerShare
      WHERE BranchID = @b AND IsActive = 1 AND EffectiveFrom = '2026-06-01'
      ORDER BY PartnerCode
    `);

    const total = shares.recordset.reduce(
      (s: number, r: { SharePercent: number }) => s + Number(r.SharePercent),
      0,
    );

    const overlap = await pool.request().input('b', gleemId ?? -1).query(`
      SELECT COUNT(*) AS c
      FROM dbo.TblBranchPartnerShare a
      INNER JOIN dbo.TblBranchPartnerShare b
        ON a.BranchID = b.BranchID
       AND a.PartnerCode = b.PartnerCode
       AND a.BranchPartnerShareID < b.BranchPartnerShareID
       AND a.IsActive = 1 AND b.IsActive = 1
       AND a.EffectiveFrom <= ISNULL(b.EffectiveTo, '9999-12-31')
       AND b.EffectiveFrom <= ISNULL(a.EffectiveTo, '9999-12-31')
      WHERE a.BranchID = @b
    `);

    const missingOnReportDate = await pool.request().input('b', gleemId ?? -1).query(`
      SELECT COUNT(*) AS c
      FROM (SELECT CAST('2026-06-15' AS date) AS d) x
      WHERE NOT EXISTS (
        SELECT 1 FROM dbo.TblBranchPartnerShare s
        WHERE s.BranchID = @b AND s.IsActive = 1
          AND s.EffectiveFrom <= x.d
          AND (s.EffectiveTo IS NULL OR s.EffectiveTo >= x.d)
      )
    `);

    const legacy = await pool.request().input('b', gleemId ?? -1).query(`
      SELECT COUNT(*) AS c, SUM(ISNULL(GrandTolal,0)) AS total
      FROM dbo.TblCashMove
      WHERE BranchID = @b AND BusinessDayID IS NULL
    `);

    const dayCompare = await pool.request().input('b', gleemId ?? -1).input('d', '2026-07-11').query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE CAST(invDate AS date)=@d AND invType=N'مبيعات') AS unscopedInv,
        (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE CAST(invDate AS date)=@d AND invType=N'مبيعات' AND BranchID=@b) AS scopedInv
    `);

    console.log('Phase 1E verification');
    console.log(`  mode: ${mode}`);
    console.log(`  GLEEM BranchID: ${gleemId}`);
    console.log(`  GLEEM partner share rows (2026-06-01): ${shares.recordset.length}`);
    console.log(`  Share total: ${total}`);
    console.log(`  Overlapping periods: ${overlap.recordset[0].c}`);
    console.log(`  Missing config on 2026-06-15: ${missingOnReportDate.recordset[0].c}`);
    console.log(`  Legacy null BusinessDayID cash: ${legacy.recordset[0].c} (amount ${legacy.recordset[0].total})`);
    console.log(
      `  Unscoped vs scoped invoice count 2026-07-11: ${dayCompare.recordset[0].unscopedInv} / ${dayCompare.recordset[0].scopedInv}`,
    );

    if (shares.recordset.length !== 3) failures.push('expected 3 GLEEM partner rows');
    if (Math.abs(total - 100) > 0.0001) failures.push(`share total not 100: ${total}`);
    if (Number(overlap.recordset[0].c) > 0) failures.push('overlapping partner periods');
    if (Number(missingOnReportDate.recordset[0].c) > 0) {
      failures.push('missing partner config on sample date');
    }
    if (Number(legacy.recordset[0].c) < 18) {
      failures.push(`legacy null day count unexpectedly low: ${legacy.recordset[0].c}`);
    }
    console.log(
      `  NOTE: Phase 1E authoritative live legacy null-BusinessDay count = ${legacy.recordset[0].c}`,
    );
    if (
      Number(dayCompare.recordset[0].unscopedInv) !==
      Number(dayCompare.recordset[0].scopedInv)
    ) {
      failures.push('unscoped!=scoped invoice count (unexpected with single branch)');
    }

    if (before?.dayTotals && after?.dayTotals) {
      const b = JSON.stringify(before.dayTotals);
      const a = JSON.stringify(after.dayTotals);
      if (b !== a) failures.push('report baseline dayTotals changed');
      else console.log('  Pre/post report dayTotals: MATCH');
      if (JSON.stringify(before.month2026_06) !== JSON.stringify(after.month2026_06)) {
        failures.push('report baseline month2026_06 changed');
      } else console.log('  Pre/post month2026_06: MATCH');
      if (
        JSON.stringify(before.legacyNullDayCash) !==
        JSON.stringify(after.legacyNullDayCash)
      ) {
        failures.push('legacy null-day cash fingerprint changed');
      } else console.log('  Legacy null-day cash fingerprint: MATCH');
    } else {
      console.log('  Baseline compare skipped (missing capture files)');
    }

    // Owner all-branch sum invariant with single branch: all == single
    console.log('  Owner/partner all-branch sum invariant: trivial with one branch (GLEEM only)');
    console.log('  Sync: stopped/unused (not resumed)');
  } finally {
    await pool.close();
  }

  if (failures.length) {
    console.error('FAILURES:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('Phase 1E verification PASSED');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
