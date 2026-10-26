import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA=path.join(__dirname,'..','..','..','db','drvo-migrations','021-commercial-policy-evidence','schema.sql');

export async function verifyCommercialPolicyEvidence(pool:ConnectionPool):Promise<{ok:boolean;failures:string[]}> {
 const failures:string[]=[];
 const t=await pool.request().query(
   "SELECT CASE WHEN OBJECT_ID(N'dbo.ModularCommercialPolicyEvidence',N'U') IS NULL THEN 0 ELSE 1 END AS ok;");
 if(Number(t.recordset[0]?.ok)!==1)return {ok:false,failures:['Missing ModularCommercialPolicyEvidence']};
 for(const col of ['EvidenceId','CandidateId','BlockerCode','Revision','EvidenceText','Status',
   'SubmittedByUserId','SubmittedAt','ReviewedByUserId','ReviewedAt','ReviewNote']){
   const r=await pool.request().input('col',col).query(
     "SELECT CASE WHEN COL_LENGTH(N'dbo.ModularCommercialPolicyEvidence',@col) IS NULL THEN 0 ELSE 1 END AS ok;");
   if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing column '+col);
 }
 for(const name of ['UX_ModularCommercialPolicyEvidence_Revision','IX_ModularCommercialPolicyEvidence_CandidateTime']){
   const r=await pool.request().input('name',name).query(
     "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.ModularCommercialPolicyEvidence') AND name=@name AND is_disabled=0) THEN 1 ELSE 0 END AS ok;");
   if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing index '+name);
 }
 const fk=await pool.request().query(
   "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.ModularCommercialPolicyEvidence') AND name=N'FK_ModularCommercialPolicyEvidence_Candidate' AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;");
 if(Number(fk.recordset[0]?.ok)!==1)failures.push('Missing trusted candidate FK');
 for(const name of ['CK_ModularCommercialPolicyEvidence_Revision','CK_ModularCommercialPolicyEvidence_Status',
  'CK_ModularCommercialPolicyEvidence_Code','CK_ModularCommercialPolicyEvidence_EvidenceText',
  'CK_ModularCommercialPolicyEvidence_Review']){
   const r=await pool.request().input('name',name).query(
     "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.ModularCommercialPolicyEvidence') AND name=@name AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok;");
   if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing/untrusted CHECK '+name);
 }
 return {ok:failures.length===0,failures};
}
export const commercialPolicyEvidenceMigration:DrvoMigrationDefinition={
  migrationId:21,migrationKey:'commercial-policy-evidence',
  name:'Internal two-person evidence review per commercial release blocker',
  dependencies:['commercial-release-candidates'],
  checksum:checksumFile(SCHEMA),
  control:{kind:'schema',risk:'LOW',requiresBackup:false,lockProfile:'short',
    rollbackStrategy:'Additive review history; remove internal UI/API while retaining immutable evidence.'},
  async apply(ctx){await executeSqlFile(ctx.pool,SCHEMA);},
  async verify(ctx){return verifyCommercialPolicyEvidence(ctx.pool);},
  async reconcileBaseline(ctx){return (await verifyCommercialPolicyEvidence(ctx.pool)).ok;},
};
