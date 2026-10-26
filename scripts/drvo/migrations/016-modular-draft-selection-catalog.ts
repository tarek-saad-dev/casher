import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(__dirname, '..', '..', '..', 'db', 'drvo-migrations',
  '016-modular-draft-selection-catalog', 'schema.sql');

export const modularDraftSelectionCatalogMigration: DrvoMigrationDefinition = {
  migrationId: 16,
  migrationKey: 'modular-draft-selection-catalog',
  name: 'Insert-only unpriced draft catalog pointers for tenant app selection',
  dependencies: ['modular-commercial-drafts'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'data',
    risk: 'LOW',
    requiresBackup: false,
    lockProfile: 'short',
    rollbackStrategy: 'Additive unpriced draft rows only. Revert the API/UI; do not delete historical draft selections.',
  },
  async apply(ctx) { await executeSqlFile(ctx.pool, SCHEMA); },
  async verify(ctx) {
    const failures: string[] = [];
    for (const [code, industry] of [
      ['salon-selection-draft', 'salon'],
      ['supermarket-selection-draft', 'supermarket'],
    ] as const) {
      const r = await ctx.pool.request()
        .input('code', code).input('industry', industry)
        .query(`SELECT
          (SELECT COUNT(*) FROM dbo.ModularPriceCatalog
           WHERE CatalogCode=@code AND Version=1 AND IndustryCode=@industry
             AND Status=N'draft' AND CurrencyCode='EGP') AS matches,
          (SELECT COUNT(*) FROM dbo.ModularPriceCatalogItem i
           INNER JOIN dbo.ModularPriceCatalog c ON c.CatalogId=i.CatalogId
           WHERE c.CatalogCode=@code AND c.Version=1) AS priceCount;`);
      if (Number(r.recordset[0]?.matches) !== 1) failures.push('Missing or modified draft catalog: ' + code);
      if (Number(r.recordset[0]?.priceCount) !== 0) failures.push('Unexpected prices in draft catalog: ' + code);
    }
    return { ok: failures.length===0, failures };
  },
  async reconcileBaseline(ctx) { return (await modularDraftSelectionCatalogMigration.verify(ctx)).ok; },
};
