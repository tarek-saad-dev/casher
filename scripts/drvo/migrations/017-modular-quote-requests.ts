import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA=path.join(__dirname,'..','..','..','db','drvo-migrations','017-modular-quote-requests','schema.sql');

export async function verifyModularQuoteRequests(pool:ConnectionPool):Promise<{ok:boolean;failures:string[]}> {
  const failures:string[]=[];
  const table=await pool.request().query(
    "SELECT CASE WHEN OBJECT_ID(N'dbo.TenantModularQuoteRequest',N'U') IS NULL THEN 0 ELSE 1 END AS ok;");
  if(Number(table.recordset[0]?.ok)!==1) return {ok:false,failures:['Missing dbo.TenantModularQuoteRequest']};
  for(const col of ['RequestId','TenantId','DraftId','DraftRevision','CatalogId','IndustryCode',
    'AppsJson','BranchCount','BillingCycle','Status','RequestedByUserId','CreatedAt','UpdatedAt']){
    const r=await pool.request().input('col',col).query(
      "SELECT CASE WHEN COL_LENGTH(N'dbo.TenantModularQuoteRequest',@col) IS NULL THEN 0 ELSE 1 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1) failures.push('Missing column '+col);
  }
  for(const name of ['UX_TenantModularQuoteRequest_DraftRevision','IX_TenantModularQuoteRequest_TenantHistory',
    'IX_TenantModularQuoteRequest_OperatorQueue']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.TenantModularQuoteRequest') AND name=@name) THEN 1 ELSE 0 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1) failures.push('Missing index '+name);
  }
  for(const name of ['FK_TenantModularQuoteRequest_Tenant','FK_TenantModularQuoteRequest_Draft',
    'FK_TenantModularQuoteRequest_Catalog']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.TenantModularQuoteRequest') AND name=@name AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1) failures.push('Missing FK '+name);
  }
  for(const name of ['CK_TenantModularQuoteRequest_Json','CK_TenantModularQuoteRequest_Status',
    'CK_TenantModularQuoteRequest_Cycle']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.TenantModularQuoteRequest') AND name=@name AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1) failures.push('Missing CHECK '+name);
  }
  return {ok:failures.length===0,failures};
}
export const modularQuoteRequestsMigration:DrvoMigrationDefinition={
  migrationId:17,migrationKey:'modular-quote-requests',
  name:'Nonpayable modular quote inquiry snapshots (no amounts or orders)',
  dependencies:['modular-draft-selection-catalog'],
  checksum:checksumFile(SCHEMA),
  control:{kind:'schema',risk:'LOW',requiresBackup:false,lockProfile:'short',
    rollbackStrategy:'Additive-only inquiry table; application rollback leaves existing inquiry history intact.'},
  async apply(ctx){await executeSqlFile(ctx.pool,SCHEMA);},
  async verify(ctx){return verifyModularQuoteRequests(ctx.pool);},
  async reconcileBaseline(ctx){return (await verifyModularQuoteRequests(ctx.pool)).ok;},
};
