/**
 * Disposable CI-only SQL Server integration fixture for DRVO 019–022.
 * Never connects to staging/production. Safe only on a local SQL container.
 * Does not run any DRVO production migration CLI or touch existing data.
 */
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import sql from 'mssql';
import {executeSqlFile} from '../sqlBatch';
import {verifyTariffResearchSchema} from '../migrations/019-tariff-research-review';
import {verifyCommercialReleaseCandidates} from '../migrations/020-commercial-release-candidates';
import {verifyCommercialPolicyEvidence} from '../migrations/021-commercial-policy-evidence';
import {verifyInternalQuoteSnapshotSchema} from '../migrations/022-internal-quote-snapshots';
import {prepareCatalogReleaseCandidate} from '../../../src/platform/commercial/commercialReleasePolicy';
import {RESEARCH_SALON_APPS} from '../../../src/platform/commercial/tariffResearchPolicy';
import {simulateModularResearchInquiry} from '../../../src/platform/commercial/modularQuoteLab';
import {makeInternalQuoteSnapshot,verifyInternalQuoteSnapshot} from '../../../src/platform/commercial/internalQuoteSnapshotPolicy';

const HOST='127.0.0.1',PORT=14331,DB='drvo_modular_ci_fixture';
const PASSWORD=process.env.DRVO_MODULAR_SQL_FIXTURE_PASSWORD;
if(process.env.DRVO_MODULAR_SQL_FIXTURE!=='1'||process.env.GITHUB_ACTIONS!=='true'||
   process.env.CI!=='true'||!PASSWORD||
   process.env.DB_SERVER||process.env.CLOUD_DB_SERVER||process.env.LOCAL_DB_SERVER)
 throw new Error('FIXTURE_TARGET_REFUSED: only isolated GitHub Actions SQL fixture with no application DB target');
const cfg=(database:string)=>({
 server:HOST,port:PORT,database,user:'sa',password:PASSWORD,
 options:{encrypt:false,trustServerCertificate:true},
 connectionTimeout:3000,requestTimeout:15000,pool:{min:0,max:3},
});
function assert(cond:unknown,message:string):asserts cond{
 if(!cond)throw new Error('SQL_FIXTURE_ASSERT: '+message);
}
async function refused(promise:Promise<unknown>,codes:number[],label:string){
 try{await promise;throw new Error('SQL_FIXTURE_ASSERT: should reject '+label);}
 catch(error){
  const code=Number((error as {number?:number}).number);
  if(!codes.includes(code))throw error;
  console.log('EXPECTED SQL rejection: '+label);
 }
}
const rows=<T extends object>(r:sql.IResult<T>)=>r.recordset;
async function main(){
 let server:sql.ConnectionPool|undefined,db:sql.ConnectionPool|undefined;
 try{
  // SQL container may need time to start; never retry another host.
  for(let i=0;i<50;i++){
   try{server=await new sql.ConnectionPool(cfg('master')).connect();break;}
   catch{await new Promise(resolve=>setTimeout(resolve,2500));}
  }
  assert(server,'Disposable SQL Server did not start at isolated loopback port 14331');
  const auth=await server.request().query('SELECT DB_NAME() AS db, ORIGINAL_LOGIN() AS login, @@SERVERNAME AS serverName');
  assert(auth.recordset[0]?.db==='master'&&String(auth.recordset[0]?.login).toLowerCase()==='sa',
    'Wrong local SQL identity; refusing DDL');
  const exists=await server.request().input('db',sql.NVarChar(128),DB)
    .query('SELECT DB_ID(@db) AS dbId;');
  assert(!exists.recordset[0]?.dbId,'Fixture database already exists; refusing overwrite');
  await server.request().batch('CREATE DATABASE [drvo_modular_ci_fixture];');
  db=await new sql.ConnectionPool(cfg(DB)).connect();
  assert((await db.request().query('SELECT DB_NAME() AS db;')).recordset[0]?.db===DB,
    'Fixture DB identity mismatch');

  // Explicit minimal synthetic references ONLY in this disposable database.
  await db.request().batch(`
    CREATE TABLE dbo.Tenant(
      TenantId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
      Code NVARCHAR(50) NOT NULL,
      Status NVARCHAR(20) NOT NULL
    );
    CREATE TABLE dbo.TenantModularQuoteRequest(
      TenantId UNIQUEIDENTIFIER NOT NULL,
      RequestId UNIQUEIDENTIFIER NOT NULL,
      DraftRevision INT NOT NULL,
      Status NVARCHAR(24) NOT NULL,
      IndustryCode NVARCHAR(32) NOT NULL,
      AppsJson NVARCHAR(MAX) NOT NULL,
      BranchCount INT NOT NULL,
      BillingCycle NVARCHAR(10) NOT NULL,
      CONSTRAINT UX_CIFixture_TenantRequest UNIQUE(TenantId,RequestId)
    );
  `);
  const versions=['019-tariff-research-review','020-commercial-release-candidates',
    '021-commercial-policy-evidence','022-internal-quote-snapshots'];
  for(const version of versions){
   await executeSqlFile(db,path.join(process.cwd(),'db','drvo-migrations',version,'schema.sql'));
   console.log('Applied isolated SQL fixture migration '+version);
  }
  const verifiers=[
   verifyTariffResearchSchema,verifyCommercialReleaseCandidates,
   verifyCommercialPolicyEvidence,verifyInternalQuoteSnapshotSchema,
  ];
  for(let i=0;i<verifiers.length;i++){
   const status=await verifiers[i]!(db);
   assert(status.ok,'Fixture schema '+versions[i]+' invalid: '+status.failures.join('; '));
  }

  const tenantId=randomUUID(),otherTenantId=randomUUID();
  const requestId=randomUUID(),proposalId=randomUUID(),candidateId=randomUUID();
  const evidenceId=randomUUID(),snapshotId=randomUUID();
  const fakeAppPrices=Object.fromEntries(RESEARCH_SALON_APPS.map(k=>[k,100]));
  const appPricesJson=JSON.stringify(fakeAppPrices);
  await db.request().input('tenantId',sql.UniqueIdentifier,tenantId)
   .input('other',sql.UniqueIdentifier,otherTenantId)
   .query(`INSERT INTO dbo.Tenant(TenantId,Code,Status)
     VALUES (@tenantId,N'DRVO_CI_SYNTHETIC',N'active'),
            (@other,N'DRVO_CI_OTHER_SYNTHETIC',N'active');`);
  await db.request().input('tenantId',sql.UniqueIdentifier,tenantId)
   .input('requestId',sql.UniqueIdentifier,requestId)
   .input('apps',sql.NVarChar(sql.MAX),JSON.stringify(['booking','pos']))
   .query(`INSERT INTO dbo.TenantModularQuoteRequest
      (TenantId,RequestId,DraftRevision,Status,IndustryCode,AppsJson,BranchCount,BillingCycle)
      VALUES (@tenantId,@requestId,1,N'awaiting_pricing',N'salon',@apps,2,N'annual');`);
  const reviewedAt='2026-10-26T06:00:00.000Z';
  const src={
   proposalId,industryCode:'salon',version:1,pricingModel:'per_app',currencyCode:'EGP',
   appPricesJson,baseMonthlyMinor:'0',extraBranchMonthlyMinor:'50',includedBranches:1,
   annualMonthsCharged:10,status:'reviewed_research',
   createdByUserId:101,reviewedByUserId:102,reviewedAt,
  };
  const digest=prepareCatalogReleaseCandidate(src).sourceDigest;
  await db.request().input('proposalId',sql.UniqueIdentifier,proposalId)
   .input('apps',sql.NVarChar(sql.MAX),appPricesJson)
   .query(`INSERT INTO dbo.ModularTariffResearchProposal
    (ProposalId,IndustryCode,Version,PricingModel,CurrencyCode,
     AppPricesJson,BaseMonthlyMinor,ExtraBranchMonthlyMinor,IncludedBranches,
     AnnualMonthsCharged,Status,CreatedByUserId,ReviewedByUserId,ReviewedAt,ReviewNote)
     VALUES (@proposalId,N'salon',1,N'per_app','EGP',@apps,
      0,50,1,10,N'reviewed_research',101,102,'2026-10-26T06:00:00',N'CI fixture review only');`);
  await refused(db.request().input('id',sql.UniqueIdentifier,randomUUID())
   .input('source',sql.UniqueIdentifier,randomUUID())
   .input('digest',sql.Char(64),digest)
   .query(`INSERT INTO dbo.ModularCommercialReleaseCandidate
      (CandidateId,SourceProposalId,SourceVersion,IndustryCode,SourceDigest,RequestedByUserId)
      VALUES (@id,@source,1,N'salon',@digest,103);`),[547],'candidate foreign key');
  await db.request().input('id',sql.UniqueIdentifier,candidateId)
   .input('source',sql.UniqueIdentifier,proposalId)
   .input('digest',sql.Char(64),digest)
   .query(`INSERT INTO dbo.ModularCommercialReleaseCandidate
      (CandidateId,SourceProposalId,SourceVersion,IndustryCode,SourceDigest,RequestedByUserId)
      VALUES (@id,@source,1,N'salon',@digest,103);`);
  await refused(db.request().input('id',sql.UniqueIdentifier,randomUUID())
   .input('source',sql.UniqueIdentifier,proposalId)
   .input('digest',sql.Char(64),digest)
   .query(`INSERT INTO dbo.ModularCommercialReleaseCandidate
     (CandidateId,SourceProposalId,SourceVersion,IndustryCode,SourceDigest,RequestedByUserId)
      VALUES (@id,@source,1,N'salon',@digest,103);`),[2601,2627],'duplicate source candidate');
  await refused(db.request().input('id',sql.UniqueIdentifier,randomUUID())
   .input('source',sql.UniqueIdentifier,proposalId)
   .input('digest',sql.Char(64),digest)
   .query(`INSERT INTO dbo.ModularCommercialReleaseCandidate
     (CandidateId,SourceProposalId,SourceVersion,IndustryCode,SourceDigest,Status,RequestedByUserId)
     VALUES (@id,@source,1,N'salon',@digest,N'approved',103);`),[547],'candidate approval state forbidden');

  const blocker='COMMERCIAL_PRICING_NOT_APPROVED';
  await db.request().input('evidenceId',sql.UniqueIdentifier,evidenceId)
   .input('candidateId',sql.UniqueIdentifier,candidateId)
   .query(`INSERT INTO dbo.ModularCommercialPolicyEvidence
     (EvidenceId,CandidateId,BlockerCode,Revision,EvidenceText,SubmittedByUserId)
     VALUES (@evidenceId,@candidateId,N'COMMERCIAL_PRICING_NOT_APPROVED',1,
       N'CI mock policy evidence; no price approved',201);`);
  await refused(db.request().input('id',sql.UniqueIdentifier,evidenceId)
   .query(`UPDATE dbo.ModularCommercialPolicyEvidence
    SET Status=N'reviewed_internal',ReviewedByUserId=201,
        ReviewedAt=SYSUTCDATETIME(),ReviewNote=N'bad self review'
    WHERE EvidenceId=@id;`),[547],'self-review forbidden by SQL');
  await db.request().input('id',sql.UniqueIdentifier,evidenceId)
   .query(`UPDATE dbo.ModularCommercialPolicyEvidence
    SET Status=N'reviewed_internal',ReviewedByUserId=202,
        ReviewedAt=SYSUTCDATETIME(),ReviewNote=N'CI check only'
    WHERE EvidenceId=@id;`);
  await refused(db.request().input('id',sql.UniqueIdentifier,randomUUID())
   .input('candidate',sql.UniqueIdentifier,candidateId)
   .query(`INSERT INTO dbo.ModularCommercialPolicyEvidence
     (EvidenceId,CandidateId,BlockerCode,Revision,EvidenceText,SubmittedByUserId)
     VALUES (@id,@candidate,N'COMMERCIAL_PRICING_NOT_APPROVED',1,N'dup',204);`),
   [2601,2627],'duplicate evidence revision');

  const simulation=simulateModularResearchInquiry({
   requestId,tenantId,tenantCode:'DRVO_CI_SYNTHETIC',status:'awaiting_pricing',
   industry:'salon',draftRevision:1,apps:['booking','pos'],branches:2,billingCycle:'annual',
  },{
   proposalId,industry:'salon',version:1,status:'reviewed_research',
   createdByUserId:101,reviewedByUserId:102,reviewedAt,
   reviewNote:'CI fixture review only',
   pricingModel:'per_app',appPricesMinor:fakeAppPrices,
   baseMonthlyMinor:0,extraBranchMonthlyMinor:50,
   includedBranches:1,annualMonthsCharged:10,currency:'EGP',
  });
  const snap=makeInternalQuoteSnapshot({
   snapshotId,source:{requestId,tenantId,candidateId,sourceDigest:digest,
     researchVersion:1,draftRevision:1,simulation},
   createdAt:'2026-10-26T08:00:00.000Z',
  });
  assert(snap.canCheckout===false&&!snap.paid,'Fixture snapshot must not be billable');
  const insert=async(tenant:string,id:string,status:string,expiry:string)=>db!.request()
    .input('snapshotId',sql.UniqueIdentifier,id)
    .input('tenantId',sql.UniqueIdentifier,tenant)
    .input('requestId',sql.UniqueIdentifier,requestId)
    .input('candidateId',sql.UniqueIdentifier,candidateId)
    .input('sourceDigest',sql.Char(64),digest)
    .input('quoteDigest',sql.Char(64),snap.quoteDigest)
    .input('quoteJson',sql.NVarChar(sql.MAX),JSON.stringify(snap.researchQuote))
    .input('status',sql.NVarChar(20),status)
    .input('created',sql.DateTime2,new Date(snap.createdAt))
    .input('expiry',sql.DateTime2,new Date(expiry))
    .query(`INSERT INTO dbo.ModularInternalQuoteSnapshot
      (SnapshotId,TenantId,RequestId,CandidateId,ResearchVersion,DraftRevision,
       SourceDigest,QuoteDigest,ResearchQuoteJson,Status,CreatedByUserId,CreatedAt,ExpiresAt)
      VALUES (@snapshotId,@tenantId,@requestId,@candidateId,1,1,
       @sourceDigest,@quoteDigest,@quoteJson,@status,301,@created,@expiry);`);
  await refused(insert(otherTenantId,randomUUID(),'internal_only',snap.expiresAt),
    [547],'cross-tenant composite request foreign key');
  await refused(insert(tenantId,randomUUID(),'paid',snap.expiresAt),
    [547],'paid snapshot status forbidden');
  await refused(insert(tenantId,randomUUID(),'internal_only','2026-10-30T08:00:00.000Z'),
    [547],'snapshot over 48h expiry forbidden');
  await insert(tenantId,snapshotId,'internal_only',snap.expiresAt);
  await refused(insert(tenantId,randomUUID(),'internal_only',snap.expiresAt),
    [2601,2627],'duplicate tenant/request/candidate');
  const persisted=await db.request().input('id',sql.UniqueIdentifier,snapshotId)
   .query(`SELECT TenantId,RequestId,CandidateId,QuoteDigest,ResearchQuoteJson,CreatedAt,ExpiresAt,Status
    FROM dbo.ModularInternalQuoteSnapshot WHERE SnapshotId=@id;`);
  assert(persisted.recordset.length===1,'Exactly one archived record after duplicates');
  const x=persisted.recordset[0]!;
  const verified=verifyInternalQuoteSnapshot({
   ...snap,tenantId:String(x.TenantId).toLowerCase(),
   requestId:String(x.RequestId).toLowerCase(),candidateId:String(x.CandidateId).toLowerCase(),
   quoteDigest:String(x.QuoteDigest),
   researchQuote:JSON.parse(String(x.ResearchQuoteJson)),
   createdAt:new Date(x.CreatedAt).toISOString(),
   expiresAt:new Date(x.ExpiresAt).toISOString(),
   status:String(x.Status) as 'internal_only',
  },'2026-10-27T09:00:00.000Z');
  assert(verified.availability==='internal_current','Roundtripped SQL snapshot digest');
  assert(verifyInternalQuoteSnapshot(verified,'2026-10-28T08:00:00.000Z')
   .availability==='internal_expired','Snapshot TTL boundary');
  const count=(await db.request().query(`
     SELECT (SELECT COUNT(*) FROM dbo.ModularTariffResearchProposal) AS proposals,
       (SELECT COUNT(*) FROM dbo.ModularCommercialReleaseCandidate) AS candidates,
       (SELECT COUNT(*) FROM dbo.ModularCommercialPolicyEvidence) AS evidence,
       (SELECT COUNT(*) FROM dbo.ModularInternalQuoteSnapshot) AS snapshots;`)).recordset[0]!;
  assert(count.proposals===1&&count.candidates===1&&count.evidence===1&&count.snapshots===1,
    'Expected only synthetic isolated records');
  console.log('DRVO 019–022 disposable SQL integration PASS: 4 migrated schemas, verified constraints, negative tests, roundtrip and 48-hour expiry. NO STAGING OR PRODUCTION CONNECTION.');
 }finally{if(db)await db.close();if(server)await server.close();}
}
main().catch(error=>{
 console.error('DRVO disposable SQL fixture FAILED:',error instanceof Error?error.message:'unknown');
 process.exitCode=1;
});
