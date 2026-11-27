import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA=path.join(__dirname,'..','..','..','db','drvo-migrations','027-cut-offer-campaign','schema.sql');
async function verify(pool:ConnectionPool){
  const failures:string[]=[];
  const tables=['CutOfferCampaign','CutOfferParticipant','CutOfferReferral','CutOfferRedemption'];
  for(const table of tables){
    const result=await pool.request().input('table','dbo.'+table).query("SELECT CASE WHEN OBJECT_ID(@table,N'U') IS NOT NULL THEN 1 ELSE 0 END AS ok");
    if(Number(result.recordset[0]?.ok)!==1)failures.push('Missing '+table);
  }
  const result=await pool.request().query("SELECT CASE WHEN COL_LENGTH(N'dbo.TblClient',N'FacultyName') IS NOT NULL THEN 1 ELSE 0 END AS ok");
  if(Number(result.recordset[0]?.ok)!==1)failures.push('Missing TblClient.FacultyName');
  return {ok:failures.length===0,failures};
}
export const cutOfferCampaignMigration:DrvoMigrationDefinition={
  migrationId:27,
  migrationKey:'cut-offer-campaign',
  name:'Tenant-scoped offer registration, referral and redemption foundation',
  dependencies:['master-data-tenancy','customer-education-occupation-profile'],
  checksum:checksumFile(SCHEMA),
  control:{kind:'schema',risk:'MEDIUM',requiresBackup:true,lockProfile:'short',
    rollbackStrategy:'Disable campaign reads/writes; retain additive tables, audit records and nullable FacultyName. Do not delete historic redemptions.'},
  async apply(ctx){await executeSqlFile(ctx.pool,SCHEMA);},
  async verify(ctx){return verify(ctx.pool);},
};
