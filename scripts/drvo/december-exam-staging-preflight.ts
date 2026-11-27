/** Read-only staging preflight. Never imports app DB or reads env files. */
import sql from 'mssql';
async function main(){
 const password=process.env.DRVO_STAGING_DB_PASSWORD;
 if(!password)throw Error('STAGING_PASSWORD_REQUIRED');
 const pool=new sql.ConnectionPool({server:'127.0.0.1',port:14330,database:'last132_agent',user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true},connectionTimeout:15000,requestTimeout:30000});
 try{
 await pool.connect();
 const identity=await pool.request().query("SELECT DB_NAME() db,SUSER_SNAME() login");
 if(identity.recordset[0]?.db!=='last132_agent'||identity.recordset[0]?.login!=='drvo_agent')throw Error('STAGING_IDENTITY_REQUIRED');
 const checks:[string,string][]=[
 ['campaign schema',"SELECT CASE WHEN OBJECT_ID(N'dbo.CutOfferCampaign',N'U') IS NOT NULL AND OBJECT_ID(N'dbo.CutOfferParticipant',N'U') IS NOT NULL AND OBJECT_ID(N'dbo.CutOfferReferral',N'U') IS NOT NULL AND OBJECT_ID(N'dbo.CutOfferRedemption',N'U') IS NOT NULL THEN 1 ELSE 0 END ok"],
 ['education and audit',"SELECT CASE WHEN OBJECT_ID(N'dbo.CutEducationCatalog',N'U') IS NOT NULL AND OBJECT_ID(N'dbo.CutOfferOperationAudit',N'U') IS NOT NULL AND COL_LENGTH(N'dbo.TblClient',N'FacultyName') IS NOT NULL THEN 1 ELSE 0 END ok"],
 ['migration ledger',"SELECT CASE WHEN COUNT(*)=3 THEN 1 ELSE 0 END ok FROM dbo.DrvoSchemaMigration WHERE (MigrationId=27 AND MigrationKey='cut-offer-campaign') OR (MigrationId=28 AND MigrationKey='cut-education-catalog') OR (MigrationId=29 AND MigrationKey='cut-offer-operations')"],
 ['redemption unique keys',"SELECT CASE WHEN COUNT(*)=2 THEN 1 ELSE 0 END ok FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.CutOfferRedemption') AND is_unique=1 AND is_disabled=0 AND name IN(N'PK_CutOfferRedemption',N'UQ_CutOfferRedemption_Invoice')"],
 ['sales columns',"SELECT CASE WHEN COL_LENGTH(N'dbo.TblinvServHead',N'PayDue') IS NOT NULL AND COL_LENGTH(N'dbo.TblinvServHead',N'GrandTotal') IS NOT NULL AND COL_LENGTH(N'dbo.TblinvServHead',N'BranchID') IS NOT NULL AND COL_LENGTH(N'dbo.TblinvServDetail',N'SPriceAfterDis') IS NOT NULL AND OBJECT_ID(N'dbo.TblinvServPayment',N'U') IS NOT NULL THEN 1 ELSE 0 END ok"],
 ['club columns',"SELECT CASE WHEN COL_LENGTH(N'dbo.CutClubMemberAccount',N'LinkApprovedAtUtc') IS NOT NULL AND COL_LENGTH(N'dbo.TblClientLoyalty',N'IsActive') IS NOT NULL THEN 1 ELSE 0 END ok"]
 ];
 let failed=0;
 for(const [label,query] of checks){try{const r=await pool.request().query(query);const ok=Number(r.recordset[0]?.ok)===1;console.log(label+': '+(ok?'PASS':'FAIL'));if(!ok)failed++;}catch{console.log(label+': FAIL');failed++;}}
 if(failed)throw Error('DECEMBER_SCHEMA_PREFLIGHT_FAILED');
 console.log('READ_ONLY_PREFLIGHT_PASS — no financial or E2E claims');
 }finally{await pool.close();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'PREFLIGHT_FAILED');process.exitCode=1;});
