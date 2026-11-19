import path from 'node:path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition, DrvoMigrationVerifyResult } from '../types';

const SCHEMA = path.join(
  __dirname, '..', '..', '..', 'db', 'drvo-migrations',
  '023-cut-club-member-wallet', 'schema.sql',
);

const tables: Record<string, readonly string[]> = {
  CutClubMemberAccount: [
    'AccountID','TenantId','PhoneNormalized','LegacyClientID','LinkStatus',
    'LinkApprovedBy','LinkApprovedAtUtc','LinkProofType','CreatedAtUtc','UpdatedAtUtc',
  ],
  CutClubOtpPending: [
    'TokenDigest','TenantId','PhoneNormalized','Purpose','RequestID','ChallengeID',
    'Status','VerifyLease','CreatedAtUtc','ExpiresAtUtc','ConsumedAtUtc',
  ],
  CutClubCustomerSession: [
    'TokenDigest','TenantId','AccountID','CreatedAtUtc','ExpiresAtUtc','RevokedAtUtc',
  ],
};

const indexes: Record<string, readonly { name: string; unique: boolean; filtered?: boolean }[]> = {
  CutClubMemberAccount: [
    {name:'UX_CutClubMemberAccount_TenantPhone',unique:true},
    {name:'UX_CutClubMemberAccount_TenantClient',unique:true,filtered:true},
  ],
  CutClubOtpPending: [
    {name:'UX_CutClubOtpPending_Request',unique:true},
  ],
  CutClubCustomerSession: [
    {name:'IX_CutClubCustomerSession_Account',unique:false},
  ],
};

const checks: Record<string, readonly string[]> = {
  CutClubMemberAccount: [
    'CK_CutClubMemberAccount_Status',
    'CK_CutClubMemberAccount_Approved',
    'CK_CutClubMemberAccount_Phone',
  ],
  CutClubOtpPending: [
    'CK_CutClubOtpPending_Purpose',
    'CK_CutClubOtpPending_Status',
  ],
  CutClubCustomerSession: [],
};
const foreignKeys: Record<string, readonly string[]> = {
  CutClubMemberAccount: ['FK_CutClubMemberAccount_Tenant'],
  CutClubOtpPending: ['FK_CutClubOtpPending_Tenant'],
  CutClubCustomerSession: [
    'FK_CutClubCustomerSession_Account','FK_CutClubCustomerSession_Tenant',
  ],
};

export async function verifyCutClubMemberWalletSchema(
  pool: ConnectionPool,
): Promise<DrvoMigrationVerifyResult> {
  const failures: string[] = [];

  for(const [table,columns] of Object.entries(tables)) {
    const fullName='dbo.'+table;
    const obj=await pool.request().input('table',fullName).query(`
      SELECT OBJECT_ID(@table,'U') AS oid
    `);
    if(obj.recordset[0]?.oid==null) {
      failures.push('Missing '+fullName);
      continue;
    }
    for(const column of columns) {
      const res=await pool.request()
        .input('table',fullName).input('column',column)
        .query(`SELECT COL_LENGTH(@table,@column) AS col`);
      if(res.recordset[0]?.col==null)failures.push('Missing '+fullName+'.'+column);
    }
    for(const index of indexes[table]||[]) {
      const res=await pool.request()
        .input('table',fullName).input('name',index.name)
        .query(`
          SELECT is_unique,is_disabled,has_filter
          FROM sys.indexes
          WHERE object_id=OBJECT_ID(@table) AND name=@name
        `);
      const row=res.recordset[0];
      if(!row || row.is_disabled || Boolean(row.is_unique)!==index.unique ||
         (index.filtered!==undefined && Boolean(row.has_filter)!==index.filtered))
        failures.push('Missing/invalid unique or filter index '+index.name);
    }
    for(const ck of checks[table]||[]){
      const res=await pool.request()
        .input('table',fullName).input('name',ck)
        .query(`
          SELECT is_disabled,is_not_trusted FROM sys.check_constraints
          WHERE parent_object_id=OBJECT_ID(@table) AND name=@name
        `);
      const row=res.recordset[0];
      if(!row || row.is_disabled || row.is_not_trusted)
        failures.push('Missing/untrusted CHECK '+ck);
    }
    for(const fk of foreignKeys[table]||[]){
      const res=await pool.request().input('table',fullName).input('name',fk)
        .query(`
          SELECT is_disabled,is_not_trusted FROM sys.foreign_keys
          WHERE parent_object_id=OBJECT_ID(@table) AND name=@name
        `);
      const row=res.recordset[0];
      if(!row || row.is_disabled || row.is_not_trusted)
        failures.push('Missing/untrusted FK '+fk);
    }
  }
  return {ok:failures.length===0,failures};
}

export const cutClubMemberWalletMigration: DrvoMigrationDefinition = {
  migrationId: 23,
  migrationKey: 'cut-club-member-wallet-auth',
  name: 'CUT CLUB verified member account, pending OTP and revocable session tables',
  dependencies: ['platform-core', 'master-data-tenancy'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'MEDIUM',
    requiresBackup: true,
    lockProfile: 'short',
    rollbackStrategy:
      'Disable CUT_CLUB_MEMBER_WALLET_ENABLED and CUT_CLUB_WEBSITE_AUTH_ENABLED; revoke customer sessions before rollback. Retain the additive tables and immutable audit references; never delete historical loyalty ledger, vouchers or customer records.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyCutClubMemberWalletSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    return (await verifyCutClubMemberWalletSchema(ctx.pool)).ok;
  },
};
