import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(
  __dirname, '..', '..', '..', 'db', 'drvo-migrations',
  '023-referral-discounts', 'schema.sql',
);

const schemaContract = {
  TblReferralCustomerCode: {
    columns: ['ReferralCodeID', 'TenantId', 'ReferrerClientID', 'Code', 'ActivatedAtUtc'],
    indexes: [
      'UQ_ReferralCustomerCode_Owner',
      'UQ_ReferralCustomerCode_Code',
      'UQ_ReferralCustomerCode_TenantIdOwner',
    ],
    foreignKeys: ['FK_ReferralCustomerCode_Client', 'FK_ReferralCustomerCode_Tenant'],
    checks: ['CK_ReferralCustomerCode_Code'],
  },
  TblReferralVisitClaim: {
    columns: [
      'ClaimID', 'TenantId', 'ReferralCodeID', 'ReferrerClientID', 'ReferredClientID',
      'Status', 'FirstPaidInvID', 'FirstPaidInvType',
    ],
    indexes: [
      'UQ_ReferralVisitClaim_Referred',
      'UQ_ReferralVisitClaim_Owner',
      'IX_ReferralVisitClaim_Referrer',
    ],
    foreignKeys: ['FK_ReferralVisitClaim_Code', 'FK_ReferralVisitClaim_Referred'],
    checks: [
      'CK_ReferralVisitClaim_NoSelf', 'CK_ReferralVisitClaim_Status',
      'CK_ReferralVisitClaim_InvoicePair', 'CK_ReferralVisitClaim_AppliedInvoice',
    ],
  },
  TblReferralDiscountVoucher: {
    columns: [
      'VoucherID', 'TenantId', 'ClaimID', 'ReferrerClientID', 'DiscountPercent',
      'Status', 'UsedInvID', 'UsedInvType',
    ],
    indexes: ['UQ_ReferralDiscountVoucher_Claim', 'IX_ReferralDiscountVoucher_OwnerStatus'],
    foreignKeys: ['FK_ReferralDiscountVoucher_Claim'],
    checks: [
      'CK_ReferralDiscountVoucher_Percent', 'CK_ReferralDiscountVoucher_Status',
      'CK_ReferralDiscountVoucher_UsagePair', 'CK_ReferralDiscountVoucher_UsedInvoice',
    ],
  },
} as const;

export async function verifyReferralDiscountSchema(pool: ConnectionPool) {
  const failures: string[] = [];
  for (const [table, contract] of Object.entries(schemaContract)) {
    const objectName = `dbo.${table}`;
    const tableResult = await pool.request().input('objectName', objectName).query(
      "SELECT CASE WHEN OBJECT_ID(@objectName, N'U') IS NULL THEN 0 ELSE 1 END AS ok",
    );
    if (Number(tableResult.recordset[0]?.ok) !== 1) {
      failures.push(`Missing ${objectName}`);
      continue;
    }
    for (const column of contract.columns) {
      const result = await pool.request()
        .input('objectName', objectName)
        .input('column', column)
        .query('SELECT CASE WHEN COL_LENGTH(@objectName, @column) IS NULL THEN 0 ELSE 1 END AS ok');
      if (Number(result.recordset[0]?.ok) !== 1) failures.push(`Missing ${table}.${column}`);
    }
    for (const index of contract.indexes) {
      const result = await pool.request().input('objectName', objectName).input('name', index).query(`
        SELECT CASE WHEN EXISTS(
          SELECT 1 FROM sys.indexes
          WHERE object_id = OBJECT_ID(@objectName) AND name = @name AND is_disabled = 0
        ) THEN 1 ELSE 0 END AS ok
      `);
      if (Number(result.recordset[0]?.ok) !== 1) failures.push(`Missing index ${index}`);
    }
    for (const key of contract.foreignKeys) {
      const result = await pool.request().input('objectName', objectName).input('name', key).query(`
        SELECT CASE WHEN EXISTS(
          SELECT 1 FROM sys.foreign_keys
          WHERE parent_object_id = OBJECT_ID(@objectName) AND name = @name
            AND is_disabled = 0 AND is_not_trusted = 0
        ) THEN 1 ELSE 0 END AS ok
      `);
      if (Number(result.recordset[0]?.ok) !== 1) failures.push(`Missing/untrusted foreign key ${key}`);
    }
    for (const check of contract.checks) {
      const result = await pool.request().input('objectName', objectName).input('name', check).query(`
        SELECT CASE WHEN EXISTS(
          SELECT 1 FROM sys.check_constraints
          WHERE parent_object_id = OBJECT_ID(@objectName) AND name = @name
            AND is_disabled = 0 AND is_not_trusted = 0
        ) THEN 1 ELSE 0 END AS ok
      `);
      if (Number(result.recordset[0]?.ok) !== 1) failures.push(`Missing/untrusted check ${check}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

export const referralDiscountMigration: DrvoMigrationDefinition = {
  migrationId: 23,
  migrationKey: 'referral-discounts',
  name: 'Tenant-safe permanent referral codes, one-time claims and 20% discount vouchers',
  dependencies: ['master-data-tenancy'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'MEDIUM',
    requiresBackup: true,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive tables only; disable referral issuance and lookup routes, preserve historical codes and claims. Never drop data during rollback.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyReferralDiscountSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    return (await verifyReferralDiscountSchema(ctx.pool)).ok;
  },
};
