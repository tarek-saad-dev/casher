import path from 'node:path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition, DrvoMigrationVerifyResult } from '../types';

const SCHEMA = path.join(
  __dirname, '..', '..', '..', 'db', 'drvo-migrations',
  '027-cut-club-reward-command', 'schema.sql',
);
const TABLE = 'dbo.CutClubRewardCommand';
const COLUMNS = [
  'TenantId','CustomerId','SalonId','IdempotencyKey','ItemId','InventoryId',
  'CoinsCharged','BalanceAfter','VoucherCode','CreatedAtUtc',
] as const;
const CHECKS = ['CK_CutClubRewardCommand_Ids','CK_CutClubRewardCommand_Amounts'] as const;
const FKS = [
  'FK_CutClubRewardCommand_Tenant','FK_CutClubRewardCommand_Customer','FK_CutClubRewardCommand_Inventory',
] as const;

export async function verifyCutClubRewardCommandSchema(pool: ConnectionPool): Promise<DrvoMigrationVerifyResult> {
  const failures: string[] = [];
  const obj = await pool.request().input('table', TABLE).query(`SELECT OBJECT_ID(@table,'U') AS oid`);
  if (obj.recordset[0]?.oid == null) return { ok: false, failures: ['Missing ' + TABLE] };
  for (const column of COLUMNS) {
    const r = await pool.request().input('table', TABLE).input('column', column)
      .query(`SELECT COL_LENGTH(@table,@column) AS col`);
    if (r.recordset[0]?.col == null) failures.push('Missing ' + TABLE + '.' + column);
  }
  const pk = await pool.request().input('table', TABLE).query(`
    SELECT COUNT(*) AS n FROM sys.key_constraints
    WHERE parent_object_id=OBJECT_ID(@table) AND name IN (N'PK_CutClubRewardCommand',N'UQ_CutClubRewardCommand_Voucher')
  `);
  if (Number(pk.recordset[0]?.n) !== 2) failures.push('Missing PK/UNIQUE on ' + TABLE);
  for (const ck of CHECKS) {
    const r = await pool.request().input('table', TABLE).input('name', ck).query(`
      SELECT is_disabled,is_not_trusted FROM sys.check_constraints
      WHERE parent_object_id=OBJECT_ID(@table) AND name=@name
    `);
    const row = r.recordset[0];
    if (!row || row.is_disabled || row.is_not_trusted) failures.push('Missing/untrusted CHECK ' + ck);
  }
  for (const fk of FKS) {
    const r = await pool.request().input('table', TABLE).input('name', fk).query(`
      SELECT is_disabled,is_not_trusted FROM sys.foreign_keys
      WHERE parent_object_id=OBJECT_ID(@table) AND name=@name
    `);
    const row = r.recordset[0];
    if (!row || row.is_disabled || row.is_not_trusted) failures.push('Missing/untrusted FK ' + fk);
  }
  return { ok: failures.length === 0, failures };
}

export const cutClubRewardCommandMigration: DrvoMigrationDefinition = {
  migrationId: 27,
  migrationKey: 'cut-club-reward-command',
  name: 'CUT CLUB reward purchase idempotency record',
  dependencies: ['cut-club-member-wallet-auth'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'LOW',
    requiresBackup: true,
    lockProfile: 'short',
    rollbackStrategy:
      'Set CUT_CLUB_REWARD_PURCHASE_ENABLED=false. Keep the additive table: its rows are the audit trail of Coins already spent; never delete purchase records, vouchers or ledger rows.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyCutClubRewardCommandSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    return (await verifyCutClubRewardCommandSchema(ctx.pool)).ok;
  },
};
