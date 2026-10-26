import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA=path.join(__dirname,'..','..','..','db','drvo-migrations','022-internal-quote-snapshots','schema.sql');
export async function verifyInternalQuoteSnapshotSchema(pool:ConnectionPool):Promise<{ok:boolean;failures:string[]}> {
  const failures:string[]=[];
  const exists=await pool.request().query(
    "SELECT CASE WHEN OBJECT_ID(N'dbo.ModularInternalQuoteSnapshot',N'U') IS NULL THEN 0 ELSE 1 END AS ok;");
  if(Number(exists.recordset[0]?.ok)!==1)return {ok:false,failures:['Missing dbo.ModularInternalQuoteSnapshot']};
  for(const col of ['SnapshotId','TenantId','RequestId','CandidateId','ResearchVersion','DraftRevision',
    'SourceDigest','QuoteDigest','ResearchQuoteJson','Status','CreatedByUserId','CreatedAt','ExpiresAt']){
    const r=await pool.request().input('col',col).query(
      "SELECT CASE WHEN COL_LENGTH(N'dbo.ModularInternalQuoteSnapshot',@col) IS NULL THEN 0 ELSE 1 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing column '+col);
  }
  for(const name of ['UX_ModularInternalQuoteSnapshot_Source','IX_ModularInternalQuoteSnapshot_Operator',
    'IX_ModularInternalQuoteSnapshot_Tenant']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.ModularInternalQuoteSnapshot') AND name=@name AND is_disabled=0) THEN 1 ELSE 0 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing index '+name);
  }
  for(const name of ['FK_ModularInternalQuoteSnapshot_TenantRequest','FK_ModularInternalQuoteSnapshot_Candidate']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.ModularInternalQuoteSnapshot') AND name=@name AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing trusted FK '+name);
  }
  for(const name of ['CK_ModularInternalQuoteSnapshot_Versions','CK_ModularInternalQuoteSnapshot_Digests',
    'CK_ModularInternalQuoteSnapshot_Json','CK_ModularInternalQuoteSnapshot_Status',
    'CK_ModularInternalQuoteSnapshot_Expiry']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.ModularInternalQuoteSnapshot') AND name=@name AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing trusted CHECK '+name);
  }
  return {ok:failures.length===0,failures};
}
export const internalQuoteSnapshotsMigration:DrvoMigrationDefinition={
  migrationId:22,migrationKey:'internal-quote-snapshots',
  name:'Immutable 48-hour research quote snapshots, not customer sales',
  dependencies:['commercial-policy-evidence','modular-inquiry-reviews'],
  checksum:checksumFile(SCHEMA),
  control:{kind:'schema',risk:'LOW',requiresBackup:false,lockProfile:'short',
    rollbackStrategy:'Additive internal-only table. Revert API/UI and preserve snapshots for audit.'},
  async apply(ctx){await executeSqlFile(ctx.pool,SCHEMA);},
  async verify(ctx){return verifyInternalQuoteSnapshotSchema(ctx.pool);},
  async reconcileBaseline(ctx){return (await verifyInternalQuoteSnapshotSchema(ctx.pool)).ok;},
};
