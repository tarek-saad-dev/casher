/**
 * Real operator service integration on disposable CI SQL (never staging/production).
 * The setup script creates a synthetic fixture; these tests execute actual service
 * functions and transaction boundaries using the same MSSQL driver as the app.
 */
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import mssql from 'mssql';
import {randomUUID} from 'node:crypto';

const shared=vi.hoisted(()=>({pool:null as mssql.ConnectionPool|null}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/db',async()=>{
 const module=await import('mssql');
 return {sql:module.default,getPool:async()=>{
   if(!shared.pool)throw Error('Disposable SQL fixture pool not initialized');
   return shared.pool;
 }};
});
import {getCommercialReleaseCandidate,createCommercialReleaseCandidate}
  from '@/platform/commercial/commercialReleaseService';
import {
 submitCommercialPolicyEvidence,reviewCommercialPolicyEvidence,listCommercialPolicyEvidence,
} from '@/platform/commercial/commercialPolicyEvidenceService';
import {createInternalQuoteSnapshot,listInternalQuoteSnapshots}
  from '@/platform/commercial/internalQuoteSnapshotService';

const PASSWORD=process.env.DRVO_MODULAR_SQL_FIXTURE_PASSWORD;
let tenantId='',candidateId='',proposalId='';
function assertFixtureContext(){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.CI!=='true'||
   process.env.DRVO_MODULAR_SQL_FIXTURE!=='1'||!PASSWORD||
   process.env.DB_SERVER||process.env.CLOUD_DB_SERVER||process.env.LOCAL_DB_SERVER)
   throw Error('FIXTURE_TARGET_REFUSED');
}
function errorCode(error:unknown):string {
 return error&&typeof error==='object'&&'code' in error?String(error.code):'OTHER_ERROR';
}
async function expectRefused(fn:()=>Promise<unknown>,expected:string){
 try{await fn();throw Error('EXPECTED_REJECTION_MISSING');}
 catch(e){expect(errorCode(e)).toBe(expected);}
}
describe('live service transactions using synthetic SQL Server',()=>{
 beforeAll(async()=>{
  assertFixtureContext();
  const pool=await new mssql.ConnectionPool({
   server:'127.0.0.1',port:14331,database:'drvo_modular_ci_fixture',
   user:'sa',password:PASSWORD!,
   options:{encrypt:false,trustServerCertificate:true},
   connectionTimeout:3000,requestTimeout:15000,pool:{min:0,max:4},
  }).connect();
  shared.pool=pool;
  const db=await pool.request().query('SELECT DB_NAME() AS db, ORIGINAL_LOGIN() AS login;');
  if(db.recordset[0]?.db!=='drvo_modular_ci_fixture'||
     String(db.recordset[0]?.login).toLowerCase()!=='sa')
    throw Error('Fixture DB identity mismatch');
  const ids=await pool.request().query(`
    SELECT TOP 1 t.TenantId,c.CandidateId,c.SourceProposalId
    FROM dbo.Tenant t
    CROSS JOIN dbo.ModularCommercialReleaseCandidate c
    WHERE t.Code=N'DRVO_CI_SYNTHETIC';`);
  if(ids.recordset.length!==1)throw Error('Missing synthetic fixture');
  tenantId=String(ids.recordset[0].TenantId);
  candidateId=String(ids.recordset[0].CandidateId);
  proposalId=String(ids.recordset[0].SourceProposalId);
 },25000);
 afterAll(async()=>{if(shared.pool)await shared.pool.close();shared.pool=null;});
 it('real candidate service validates source and repeats without creating new candidate',async()=>{
  const candidate=await getCommercialReleaseCandidate(candidateId);
  expect(candidate).toMatchObject({
   candidateId,sourceVersion:1,state:'pending_policy',
   canPublish:false,canIssueCustomerQuote:false,canCheckout:false,
  });
  const again=await createCommercialReleaseCandidate({
   sourceProposalId:proposalId,actorUserId:431,
  });
  expect(again.candidateId).toBe(candidateId);
  expect(again.sourceDigest).toBe(candidate.sourceDigest);
  const count=await shared.pool!.request().query(
   'SELECT COUNT(*) AS cnt FROM dbo.ModularCommercialReleaseCandidate;');
  expect(count.recordset[0].cnt).toBe(1);
 });
 it('real evidence service rejects pending second submit and self-review; independent review is idempotent',async()=>{
  const args={candidateId,blockerCode:'ANNUAL_TERMS_NOT_APPROVED',
   evidenceText:'Synthetic decision only',actorUserId:551};
  const evidence=await submitCommercialPolicyEvidence(args);
  expect(evidence).toMatchObject({status:'submitted',revision:1,
   submittedByUserId:551,canPublish:false,canCheckout:false});
  await expectRefused(()=>submitCommercialPolicyEvidence(args),'PENDING_REVIEW');
  await expectRefused(()=>reviewCommercialPolicyEvidence({
   evidenceId:evidence.evidenceId,actorUserId:551,
   action:'reviewed_internal',note:'self approval not allowed',
  }),'INDEPENDENT_REVIEW_REQUIRED');
  const review={evidenceId:evidence.evidenceId,actorUserId:552,
   action:'reviewed_internal' as const,note:'Internal test review only'};
  const approvedInternal=await reviewCommercialPolicyEvidence(review);
  expect(approvedInternal).toMatchObject({status:'reviewed_internal',
   reviewedByUserId:552,reviewNote:review.note,canPublish:false});
  const retry=await reviewCommercialPolicyEvidence(review);
  expect(retry.evidenceId).toBe(approvedInternal.evidenceId);
  await expectRefused(()=>reviewCommercialPolicyEvidence({
   ...review,actorUserId:553,
  }),'ALREADY_REVIEWED');
  const next=await submitCommercialPolicyEvidence({
   ...args,evidenceText:'Revised synthetic evidence',actorUserId:553,
  });
  expect(next).toMatchObject({status:'submitted',revision:2});
  const data=await listCommercialPolicyEvidence(candidateId);
  expect(data).toMatchObject({mode:'internal_policy_evidence',
   canPublish:false,canIssueCustomerQuote:false,canCheckout:false});
  expect(data.summary.latestByBlocker['ANNUAL_TERMS_NOT_APPROVED'])
   .toEqual({revision:2,status:'submitted'});
  expect(data.rows.some(x=>x.evidenceId===approvedInternal.evidenceId)).toBe(true);
 },30000);
 it('real snapshot service persists only one internal record and returns it on replay',async()=>{
  const requestId=randomUUID();
  await shared.pool!.request()
   .input('tenantId',mssql.UniqueIdentifier,tenantId)
   .input('requestId',mssql.UniqueIdentifier,requestId)
   .input('apps',mssql.NVarChar(mssql.MAX),JSON.stringify(['booking','pos']))
   .query(`INSERT INTO dbo.TenantModularQuoteRequest
      (TenantId,RequestId,DraftRevision,Status,IndustryCode,AppsJson,BranchCount,BillingCycle)
      VALUES (@tenantId,@requestId,1,N'awaiting_pricing',N'salon',@apps,2,N'annual');`);
  const args={requestId,candidateId,actorUserId:611};
  const first=await createInternalQuoteSnapshot(args);
  expect(first).toMatchObject({requestId,tenantId,candidateId,
   status:'internal_only',canIssueCustomerQuote:false,canAcceptOrder:false,
   canCheckout:false,canActivate:false,orderCreated:false,paid:false,
   createdByUserId:611,availability:'internal_current'});
  expect(first.quoteDigest).toMatch(/^[a-f0-9]{64}$/);
  const second=await createInternalQuoteSnapshot({...args,actorUserId:612});
  expect(second.snapshotId).toBe(first.snapshotId);
  expect(second.createdByUserId).toBe(611);
  const stored=await shared.pool!.request().input('requestId',mssql.UniqueIdentifier,requestId)
   .query(`SELECT COUNT(*) AS cnt FROM dbo.ModularInternalQuoteSnapshot
      WHERE RequestId=@requestId;`);
  expect(stored.recordset[0].cnt).toBe(1);
  const archive=await listInternalQuoteSnapshots();
  expect(archive.find(s=>s.snapshotId===first.snapshotId))
   .toMatchObject({quoteDigest:first.quoteDigest,canCheckout:false});
  await shared.pool!.request().input('requestId',mssql.UniqueIdentifier,requestId)
   .query(`UPDATE dbo.TenantModularQuoteRequest
     SET Status=N'closed' WHERE RequestId=@requestId;`);
  await expectRefused(()=>createInternalQuoteSnapshot(args),'INQUIRY_CLOSED');
 },30000);
});
