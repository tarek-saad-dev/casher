import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA=path.join(__dirname,'..','..','..','db','drvo-migrations','019-tariff-research-review','schema.sql');

export async function verifyTariffResearchSchema(pool:ConnectionPool):Promise<{ok:boolean;failures:string[]}> {
  const failures:string[]=[];
  const exists=await pool.request().query(
    "SELECT CASE WHEN OBJECT_ID(N'dbo.ModularTariffResearchProposal',N'U') IS NULL THEN 0 ELSE 1 END AS ok;");
  if(Number(exists.recordset[0]?.ok)!==1)return {ok:false,failures:['Missing ModularTariffResearchProposal']};
  for(const col of ['ProposalId','IndustryCode','Version','PricingModel','CurrencyCode','AppPricesJson',
    'BaseMonthlyMinor','ExtraBranchMonthlyMinor','IncludedBranches','AnnualMonthsCharged',
    'Status','CreatedByUserId','CreatedAt','ReviewedByUserId','ReviewedAt','ReviewNote']){
    const r=await pool.request().input('col',col).query(
      "SELECT CASE WHEN COL_LENGTH(N'dbo.ModularTariffResearchProposal',@col) IS NULL THEN 0 ELSE 1 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing column '+col);
  }
  for(const name of ['UX_ModularTariffResearchProposal_IndustryVersion','IX_ModularTariffResearchProposal_Queue']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.ModularTariffResearchProposal') AND name=@name AND is_disabled=0) THEN 1 ELSE 0 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing index '+name);
  }
  for(const name of ['CK_ModularTariffResearchProposal_Version','CK_ModularTariffResearchProposal_Model',
    'CK_ModularTariffResearchProposal_Currency','CK_ModularTariffResearchProposal_Json',
    'CK_ModularTariffResearchProposal_Money','CK_ModularTariffResearchProposal_Branches',
    'CK_ModularTariffResearchProposal_Annual','CK_ModularTariffResearchProposal_Status',
    'CK_ModularTariffResearchProposal_Review']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.ModularTariffResearchProposal') AND name=@name AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;");
    if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing/untrusted CHECK '+name);
  }
  return {ok:failures.length===0,failures};
}
export const tariffResearchReviewMigration:DrvoMigrationDefinition={
  migrationId:19,migrationKey:'tariff-research-review',
  name:'Internal non-billable tariff proposal snapshots and independent review',
  dependencies:['modular-inquiry-reviews'],
  checksum:checksumFile(SCHEMA),
  control:{kind:'schema',risk:'LOW',requiresBackup:false,lockProfile:'short',
    rollbackStrategy:'Additive research table. Revert the operator feature; retain immutable research and audit rows.'},
  async apply(ctx){await executeSqlFile(ctx.pool,SCHEMA);},
  async verify(ctx){return verifyTariffResearchSchema(ctx.pool);},
  async reconcileBaseline(ctx){return (await verifyTariffResearchSchema(ctx.pool)).ok;},
};
