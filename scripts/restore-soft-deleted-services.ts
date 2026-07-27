/**
 * One-time recovery: restore soft-deleted rows in dbo.TblPro.
 *
 * Soft-delete field: isDeleted (1 = deleted, 0/NULL = active).
 * No DeletedAt / DeletedBy columns exist on TblPro.
 *
 * Restores existing ProIDs only — does not insert rows or change
 * names, prices, categories, durations, commissions, or relations.
 *
 * Usage:
 *   npx tsx scripts/restore-soft-deleted-services.ts
 *   npx tsx scripts/restore-soft-deleted-services.ts --dry-run
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envPath of ['.env.local', '.env']) {
  try {
    const envText = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of envText.split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        let value = match[2].trim();
        value = value.replace(/^["']|["']$/g, '');
        process.env[match[1]] = value;
      }
    }
  } catch {
    // optional
  }
}

const DRY_RUN = process.argv.includes('--dry-run');

type ColInfo = { COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string };
type SoftDeletedRow = {
  ProID: number;
  ProName: string;
  CatName: string | null;
  CatType: string | null;
  isDeleted: number | boolean | null;
};

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const pool = await getPool();

  console.log('=== Soft-deleted TblPro recovery ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE'}`);
  console.log('');

  // 1) Inspect soft-delete related columns
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblPro'
      AND (
        LOWER(COLUMN_NAME) LIKE N'%delet%'
        OR LOWER(COLUMN_NAME) IN (N'isactive', N'active', N'status')
      )
    ORDER BY COLUMN_NAME
  `);

  const deleteCols = cols.recordset as ColInfo[];
  console.log('Soft-delete / status columns on dbo.TblPro:');
  if (deleteCols.length === 0) {
    console.log('  (none matched — unexpected)');
  } else {
    for (const c of deleteCols) {
      console.log(`  - ${c.COLUMN_NAME} (${c.DATA_TYPE}, nullable=${c.IS_NULLABLE})`);
    }
  }

  const hasIsDeleted = deleteCols.some((c) => c.COLUMN_NAME.toLowerCase() === 'isdeleted');
  if (!hasIsDeleted) {
    console.error('\nABORT: dbo.TblPro.isDeleted not found. No restore performed.');
    process.exit(1);
  }

  const hasDeletedAt = deleteCols.some((c) => c.COLUMN_NAME.toLowerCase() === 'deletedat');
  const hasDeletedBy = deleteCols.some((c) => c.COLUMN_NAME.toLowerCase() === 'deletedby');
  console.log(`\nRestore strategy: SET isDeleted = 0 WHERE isDeleted = 1`);
  console.log(`Clear DeletedAt: ${hasDeletedAt ? 'yes' : 'n/a'}`);
  console.log(`Clear DeletedBy: ${hasDeletedBy ? 'yes' : 'n/a'}`);

  // 2) Find soft-deleted rows
  const found = await pool.request().query(`
    SELECT
      p.ProID,
      p.ProName,
      c.CatName,
      c.CatType,
      p.isDeleted
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    WHERE p.isDeleted = 1
    ORDER BY p.ProID
  `);

  const rows = found.recordset as SoftDeletedRow[];
  const foundCount = rows.length;
  console.log(`\nFound soft-deleted services: ${foundCount}`);

  if (foundCount === 0) {
    console.log('\nReport:');
    console.log(`  found:    0`);
    console.log(`  restored: 0`);
    console.log(`  skipped:  0`);
    console.log(`  failed:   0`);
    console.log('\nNothing to do (idempotent).');
    process.exit(0);
  }

  console.log('\nSample (up to 20):');
  for (const r of rows.slice(0, 20)) {
    console.log(
      `  #${r.ProID}  ${r.ProName}  [${r.CatName ?? '—'} / ${r.CatType ?? '—'}]`,
    );
  }
  if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);

  if (DRY_RUN) {
    console.log('\nReport (dry-run):');
    console.log(`  found:    ${foundCount}`);
    console.log(`  restored: 0 (dry-run)`);
    console.log(`  skipped:  0`);
    console.log(`  failed:   0`);
    console.log('\nRe-run without --dry-run to apply.');
    process.exit(0);
  }

  // 3) Transactional restore — only flip isDeleted; leave all other columns untouched
  const transaction = new sql.Transaction(pool);
  let restored = 0;
  let skipped = 0;
  let failed = 0;

  try {
    await transaction.begin();

    const clearParts = ['isDeleted = 0'];
    if (hasDeletedAt) clearParts.push('DeletedAt = NULL');
    if (hasDeletedBy) clearParts.push('DeletedBy = NULL');

    const updateResult = await new sql.Request(transaction).query(`
      UPDATE dbo.TblPro
      SET ${clearParts.join(', ')}
      WHERE isDeleted = 1;

      SELECT @@ROWCOUNT AS RestoredCount;
    `);

    restored = Number(updateResult.recordset?.[0]?.RestoredCount ?? 0);

    // Verify none remain deleted that we intended to restore (idempotency check)
    const remaining = await new sql.Request(transaction).query(`
      SELECT COUNT(*) AS Remaining FROM dbo.TblPro WHERE isDeleted = 1
    `);
    const remainingCount = Number(remaining.recordset[0]?.Remaining ?? 0);
    if (remainingCount !== 0) {
      throw new Error(
        `Post-update verification failed: ${remainingCount} row(s) still have isDeleted=1`,
      );
    }

    await transaction.commit();
  } catch (err) {
    failed = foundCount;
    restored = 0;
    try {
      await transaction.rollback();
    } catch {
      // ignore
    }
    console.error('\nTransaction failed — rolled back.', err);
    console.log('\nReport:');
    console.log(`  found:    ${foundCount}`);
    console.log(`  restored: 0`);
    console.log(`  skipped:  ${skipped}`);
    console.log(`  failed:   ${failed}`);
    process.exit(1);
  }

  // Re-run safety: already-active rows were never selected → skipped = 0 this run
  console.log('\nReport:');
  console.log(`  found:    ${foundCount}`);
  console.log(`  restored: ${restored}`);
  console.log(`  skipped:  ${skipped}`);
  console.log(`  failed:   ${failed}`);
  console.log('\nDone. Re-running this script will find 0 soft-deleted rows (idempotent).');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
