/** Targeted staging schema apply. Only migrations 027–029; never production. */
import sql from 'mssql';
import {DRVO_MIGRATIONS,assertDrvoMigrationManifestValid} from './migrations/index';
import {runDrvoMigrationsCore} from './runner';
import {listAppliedDrvoMigrations,recordDrvoMigration} from './registry';
import {isAcceptedChecksum} from './checksum';
async function main(){
 if(process.env.DECEMBER_STAGING_SCHEMA_APPLY!=='true'||process.env.CI!=='true')throw Error('EXPLICIT_STAGING_APPLY_REQUIRED');
 const password=process.env.DRVO_STAGING_DB_PASSWORD;
 if(!password)throw Error('STAGING_PASSWORD_REQUIRED');
 const pool=await new sql.ConnectionPool({server:'127.0.0.1',port:14330,database:'last132_agent',user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true},connectionTimeout:15000,requestTimeout:60000}).connect();
 try{
 const identity=await pool.request().query("SELECT DB_NAME() db,SUSER_SNAME() login");
 if(identity.recordset[0]?.db!=='last132_agent'||identity.recordset[0]?.login!=='drvo_agent')throw Error('STAGING_IDENTITY_REQUIRED');
 assertDrvoMigrationManifestValid();
 const expected=new Map([[27,'cut-offer-campaign'],[28,'cut-education-catalog'],[29,'cut-offer-operations']]);
 const selected=DRVO_MIGRATIONS.filter(m=>expected.get(m.migrationId)===m.migrationKey);
 if(selected.length!==3)throw Error('DECEMBER_MANIFEST_MISMATCH');
 const existing=await listAppliedDrvoMigrations(pool);
 const known=new Map(existing.map(m=>[m.MigrationKey,m]));
 // Do not create/upgrade the migration registry or apply any other missing migration.
 const registry=await pool.request().query("SELECT CASE WHEN COL_LENGTH(N'dbo.DrvoSchemaMigration',N'ApprovalRef') IS NOT NULL AND COL_LENGTH(N'dbo.DrvoSchemaMigration',N'BackupRef') IS NOT NULL THEN 1 ELSE 0 END ok");
 if(registry.recordset[0]?.ok!==1)throw Error('REGISTRY_NOT_READY');
 for(const m of selected){
  const sameId=existing.find(r=>r.MigrationId===m.migrationId);
  if(sameId&&sameId.MigrationKey!==m.migrationKey)throw Error('DECEMBER_MIGRATION_ID_CONFLICT');
  for(const dep of m.dependencies){
   if(selected.some(s=>s.migrationKey===dep))continue;
   const definition=DRVO_MIGRATIONS.find(s=>s.migrationKey===dep),applied=known.get(dep);
   if(!definition||!applied||!isAcceptedChecksum(definition,applied.Checksum))throw Error('DEPENDENCY_NOT_VERIFIED:'+dep);
   const verified=await definition.verify({pool,database:'last132_agent',appCommitSha:null});
   if(!verified.ok)throw Error('DEPENDENCY_SCHEMA_NOT_READY:'+dep);
  }
 }
 const report=await runDrvoMigrationsCore({pool,migrations:selected,opts:{allowProduction:false,expectedDatabase:'last132_agent',appCommitSha:process.env.DEPLOY_COMMIT_SHA??null},
 registry:{ensure:async()=>{},list:()=>listAppliedDrvoMigrations(pool),record:input=>recordDrvoMigration(pool,input)}});
 if(!report.ok)throw Error('DECEMBER_APPLY_FAILED');
 for(const m of selected){const v=await m.verify({pool,database:'last132_agent',appCommitSha:null});if(!v.ok)throw Error('VERIFY_FAILED:'+m.migrationKey);}
 console.log('Applied:',report.applied.join(',')||'none');console.log('Previously applied:',report.skipped.join(',')||'none');
 console.log('DECEMBER_TARGETED_STAGING_SCHEMA_PASS');
 }finally{await pool.close();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'STAGING_APPLY_FAILED');process.exitCode=1;});
