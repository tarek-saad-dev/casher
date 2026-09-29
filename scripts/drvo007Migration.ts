import fs from 'fs';
import path from 'path';

type SqlBatchRunner = {
  request: () => {
    batch: (sqlText: string) => Promise<unknown>;
    query: (sqlText: string) => Promise<{ recordset: Array<Record<string, unknown>> }>;
  };
};

export function readDrvo007MigrationBatches(): string[] {
  const file = path.join(__dirname, '..', 'db/migrations/add-drvo-007-treasury-movement-registry.sql');
  const text = fs.readFileSync(file, 'utf8');
  return text.split(/^\s*GO\s*$/gim).map((batch) => batch.trim()).filter(Boolean);
}

export async function applyDrvo007TreasuryMigration(pool: SqlBatchRunner): Promise<void> {
  const batches = readDrvo007MigrationBatches();
  for (let i = 0; i < batches.length; i++) {
    await pool.request().batch(batches[i]!);
  }
  const check = await pool.request().query(`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NULL THEN 0 ELSE 1 END AS registry,
      CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'ReversalOfCashMoveId') IS NULL THEN 0 ELSE 1 END AS reversalOf,
      CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'IsReversed') IS NULL THEN 0 ELSE 1 END AS isReversed
  `);
  const row = check.recordset[0];
  if (!row || Number(row.registry) !== 1 || Number(row.reversalOf) !== 1 || Number(row.isReversed) !== 1) {
    throw new Error('DRVO-007 migration did not create the registry and reversal columns');
  }
}
