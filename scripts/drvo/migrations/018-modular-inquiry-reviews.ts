import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA=path.join(__dirname,'..','..','..','db','drvo-migrations','018-modular-inquiry-reviews','schema.sql');

export async function verifyModularInquiryReviewSchema(pool:ConnectionPool):Promise<{ok:boolean;failures:string[]}> {
  const failures:string[]=[];
  const exists=await pool.request().query(
    "SELECT CASE WHEN OBJECT_ID(N'dbo.TenantModularInquiryReview',N'U') IS NULL THEN 0 ELSE 1 END AS ok;");
  if(Number(exists.recordset[0]?.ok)!==1) return {ok:false,failures:['Missing dbo.TenantModularInquiryReview']};
  for(const col of ['ReviewId','TenantId','RequestId','Outcome','Note','ReviewedByUserId','ReviewedAt']) {
    const r=await pool.request().input('col',col).query(
      "SELECT CASE WHEN COL_LENGTH(N'dbo.TenantModularInquiryReview',@col) IS NULL THEN 0 ELSE 1 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1) failures.push('Missing column '+col);
  }
  for(const [table,name] of [
    ['TenantModularQuoteRequest','UX_TenantModularQuoteRequest_TenantRequest'],
    ['TenantModularInquiryReview','UX_TenantModularInquiryReview_Request'],
    ['TenantModularInquiryReview','IX_TenantModularInquiryReview_TenantTime'],
  ] as const) {
    const r=await pool.request().input('name',name).input('table','dbo.'+table).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(@table) AND name=@name AND is_disabled=0) THEN 1 ELSE 0 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1) failures.push('Missing index '+name);
  }
  const fk=await pool.request().query(
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.TenantModularInquiryReview') AND name=N'FK_TenantModularInquiryReview_TenantRequest' AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;");
  if(Number(fk.recordset[0]?.ok)!==1) failures.push('Untrusted tenant/request foreign key');
  for(const name of ['CK_TenantModularInquiryReview_Outcome','CK_TenantModularInquiryReview_Note']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.TenantModularInquiryReview') AND name=@name AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1) failures.push('Missing or untrusted CHECK '+name);
  }
  return {ok:failures.length===0,failures};
}
export const modularInquiryReviewsMigration:DrvoMigrationDefinition={
  migrationId:18,migrationKey:'modular-inquiry-reviews',
  name:'Operator audit of unpriced modular inquiries without orders or payment',
  dependencies:['modular-quote-requests'],
  checksum:checksumFile(SCHEMA),
  control:{kind:'schema',risk:'LOW',requiresBackup:false,lockProfile:'short',
    rollbackStrategy:'Additive-only review table/index; code rollback does not delete reviews or tenant requests.'},
  async apply(ctx){await executeSqlFile(ctx.pool,SCHEMA);},
  async verify(ctx){return verifyModularInquiryReviewSchema(ctx.pool);},
  async reconcileBaseline(ctx){return (await verifyModularInquiryReviewSchema(ctx.pool)).ok;},
};
