import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile, legacyCrlfChecksumFile } from '../checksum';
import { collectInsCashMoveSalesDirectionFailures } from '../insCashMoveSalesDirections';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'drvo-migrations',
  '008-ins-cash-move-sales-guard',
  'schema.sql',
);

export async function verifyInsCashMoveSalesGuard(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const trigger = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.InsCashMoveSales', N'TR') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(trigger.recordset[0]?.ok) !== 1) {
    failures.push('InsCashMoveSales trigger missing');
    return { ok: false, failures };
  }

  const body = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.InsCashMoveSales')) AS definition;
  `);
  const definition = String(body.recordset[0]?.definition ?? '');
  if (!definition.includes('TreasuryMovementRegistry')) {
    failures.push('InsCashMoveSales missing TreasuryMovementRegistry coexistence guard');
  }
  if (!definition.includes("r.Kind = N'sale'")) {
    failures.push('InsCashMoveSales guard must match TreasuryMovementRegistry Kind sale');
  }
  if (!/NOT\s+EXISTS/i.test(definition) || !/c\.invID\s*=\s*i\.invID/i.test(definition)) {
    failures.push('InsCashMoveSales guard must skip per inserted invID when a Treasury sale row exists');
  }
  if (!/c\.invType\s*=\s*i\.invType/i.test(definition)) {
    failures.push('InsCashMoveSales guard must match the inserted invType');
  }
  if (!definition.includes('i.BranchID') || !/BranchID\s+IS\s+NOT\s+NULL/i.test(definition)) {
    failures.push('InsCashMoveSales must keep BranchID inheritance from the sale head');
  }
  failures.push(...collectInsCashMoveSalesDirectionFailures(definition));

  return { ok: failures.length === 0, failures };
}

export const insCashMoveSalesGuardMigration: DrvoMigrationDefinition = {
  migrationId: 8,
  migrationKey: 'ins-cash-move-sales-guard',
  name: 'DRVO-009 InsCashMoveSales Treasury coexistence guard',
  dependencies: ['treasury-movement-registry'],
  checksum: checksumFile(SCHEMA),
  legacyChecksums: [legacyCrlfChecksumFile(SCHEMA)],
  control: {
    kind: 'mixed',
    risk: 'HIGH',
    requiresBackup: true,
    lockProfile: 'potentially-blocking',
    rollbackStrategy:
      'Restore approved backup; re-create prior InsCashMoveSales body from scripts/audit-branches/_insCashMoveSales.sql if rollback required.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyInsCashMoveSalesGuard(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    const report = await verifyInsCashMoveSalesGuard(ctx.pool);
    return report.ok;
  },
};
