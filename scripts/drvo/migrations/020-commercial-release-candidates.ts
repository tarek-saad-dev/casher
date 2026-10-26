import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA=path.join(__dirname,'..','..','..','db','drvo-migrations','020-commercial-release-candidates','schema.sql');

export async function verifyCommercialReleaseCandidates(pool:ConnectionPool):Promise<{ok:boolean;failures:string[]}> {
  const failures:string[]=[];
  const present=await pool.request().query(
    "SELECT CASE WHEN OBJECT_ID(N'dbo.ModularCommercialReleaseCandidate',N'U') IS NULL THEN 0 ELSE 1 END AS ok");
  if(Number(present.recordset[0]?.ok)!==1)return {ok:false,failures:['Missing release candidate table']};
  for(const column of ['CandidateId','SourceProposalId','SourceVersion','IndustryCode','SourceDigest','Status','RequestedByUserId','CreatedAt']) {
    const r=await pool.request().input('column',column).query(
      "SELECT CASE WHEN COL_LENGTH(N'dbo.ModularCommercialReleaseCandidate',@column) IS NULL THEN 0 ELSE 1 END AS ok");
    if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing '+column);
  }
  for(const name of ['UX_ModularCommercialReleaseCandidate_Source','IX_ModularCommercialReleaseCandidate_Industry']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.ModularCommercialReleaseCandidate') AND name=@name AND is_disabled=0) THEN 1 ELSE 0 END AS ok");
    if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing index '+name);
  }
  const fk=await pool.request().query(
    "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.ModularCommercialReleaseCandidate') AND name=N'FK_ModularCommercialReleaseCandidate_Source' AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok");
  if(Number(fk.recordset[0]?.ok)!==1)failures.push('Missing trusted source FK');
  for(const name of ['CK_ModularCommercialReleaseCandidate_Version','CK_ModularCommercialReleaseCandidate_Status','CK_ModularCommercialReleaseCandidate_Digest']){
    const r=await pool.request().input('name',name).query(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.ModularCommercialReleaseCandidate') AND name=@name AND is_disabled=0 AND is_not_trusted=0) THEN 1 ELSE 0 END AS ok");
    if(Number(r.recordset[0]?.ok)!==1)failures.push('Missing trusted check '+name);
  }
  return {ok:failures.length===0,failures};
}
export const commercialReleaseCandidatesMigration:DrvoMigrationDefinition={
  migrationId:20,migrationKey:'commercial-release-candidates',
  name:'Unapproved commercial catalog launch preparation with audited research source digest',
  dependencies:['tariff-research-review'],
  checksum:checksumFile(SCHEMA),
  control:{kind:'schema',risk:'LOW',requiresBackup:false,lockProfile:'short',
    rollbackStrategy:'Additive unapproved-candidate only; revert operator routes and preserve source references.'},
  async apply(ctx){await executeSqlFile(ctx.pool,SCHEMA);},
  async verify(ctx){return verifyCommercialReleaseCandidates(ctx.pool);},
  async reconcileBaseline(ctx){return (await verifyCommercialReleaseCandidates(ctx.pool)).ok;},
};
