import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import sql from 'mssql';
vi.mock('server-only',()=>({}));
import {membershipTrial} from '@/lib/cut-club/membershipTrialSql';
import {saveMembershipDraft} from '@/lib/cut-club/membershipDraftSql';
import {recordMembershipProof} from '@/lib/cut-club/membershipProofSql';
import {pilotTenant} from '@/lib/cut-club/membershipDraft';
const enabled=process.env.CI==='true'&&process.env.MEMBERSHIP_EPHEMERAL_SQL==='1'&&process.env.MEMBERSHIP_EPHEMERAL_HOST==='127.0.0.1'&&!process.env.DB_SERVER&&!process.env.CLOUD_DB_SERVER;
const scope={tenantId:pilotTenant,staffId:71},accountId='22222222-2222-4222-8222-222222222222';
const draft={code:'STUDENTS_01',expectedRevision:0,title:'طلاب',kind:'STUDENT',minimumVisits:2,allowedBranchIds:[1,3],partnerCode:'UNI',reason:'initial draft'};
const approve=()=>({action:'APPROVE',accountId,kind:'STUDENT',expectedRevision:0,expectedClientId:7,reviewedInPerson:true,partnerCode:'UNI',expiresAt:new Date(Date.now()+86400000*3).toISOString(),reason:'reviewed in person'});
const command=()=>({action:'ISSUE',accountId,programCode:draft.code,programRevision:1,branchId:1,expectedTrialRevision:0,expiresAt:new Date(Date.now()+86400000).toISOString(),reason:'isolated trial'});
let pool:sql.ConnectionPool;
const count=async()=>(await pool.request().query('SELECT COUNT(*) AS C FROM dbo.CutClubMembershipTrial')).recordset[0].C;
describe.skipIf(!enabled)('membership issuance real SQL (disposable)',()=>{
 beforeAll(async()=>{
 const password=process.env.MEMBERSHIP_EPHEMERAL_AGENT;if(!password)throw Error('MISSING_TEST_LOGIN');
 pool=await new sql.ConnectionPool({server:'127.0.0.1',port:1433,database:'last132_agent',user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true},pool:{max:6,min:0}}).connect();
 const c=await pool.request().query('SELECT DB_NAME() AS Db,SUSER_SNAME() AS LoginName');
 if(c.recordset[0]?.Db!=='last132_agent'||c.recordset[0]?.LoginName!=='drvo_agent')throw Error('WRONG_DB');
 });
 afterAll(async()=>{if(pool){try{await pool.request().query('DELETE dbo.CutClubMembershipTrial');}finally{await pool.close();}}});
 beforeEach(async()=>{
 process.env.CUT_CLUB_STAGING_MEMBERSHIP_DRAFT_ENABLED='true';
 process.env.CUT_CLUB_STAGING_MEMBERSHIP_PROOF_ENABLED='true';
 process.env.CUT_CLUB_STAGING_MEMBERSHIP_TRIAL_ENABLED='true';
 await pool.request().query(`DELETE dbo.CutClubMembershipTrial; DELETE dbo.CutClubMembershipProgramDraft; DELETE dbo.CutClubMembershipProofEvent;
 UPDATE dbo.CutClubMemberAccount SET AccessStatus='ENABLED',LinkStatus='ACTIVE',LegacyClientID=7 WHERE AccountID='${accountId}';
 UPDATE dbo.TblClient SET Mobile='01000000000' WHERE ClientID=7;
 UPDATE dbo.TblClientLoyalty SET TotalVisits=3 WHERE ClientID=7;`);
 await saveMembershipDraft(pool,scope,draft);
 await recordMembershipProof(pool,scope,approve());
 });
 it('reads actual facts, issues once and renews only after expiry',async()=>{
 const cmd=command();
 expect(await membershipTrial(pool,scope,{...cmd,action:'CHECK'})).toMatchObject({eligible:true,visits:3,proofRevision:1,status:'NONE',issued:false});
 expect(await count()).toBe(0);
 expect(await membershipTrial(pool,scope,cmd)).toMatchObject({status:'CURRENT',trialRevision:1,issued:true});
 await expect(membershipTrial(pool,scope,{...cmd,expectedTrialRevision:1,branchId:3})).rejects.toMatchObject({code:'TRIAL_ALREADY_CURRENT'});
 await pool.request().query('UPDATE dbo.CutClubMembershipTrial SET ExpiresAtUtc=DATEADD(SECOND,-1,SYSUTCDATETIME())');
 expect(await membershipTrial(pool,scope,{...cmd,action:'CHECK'})).toMatchObject({status:'EXPIRED'});
 expect(await membershipTrial(pool,scope,{...cmd,expectedTrialRevision:1})).toMatchObject({trialRevision:2,issued:true});
 expect(await count()).toBe(2);
 });
 it('denies unverified visits, overlong entitlement, stale program and revoked evidence',async()=>{
 const cmd=command();
 await pool.request().query('UPDATE dbo.TblClientLoyalty SET TotalVisits=1 WHERE ClientID=7');
 expect(await membershipTrial(pool,scope,{...cmd,action:'CHECK'})).toMatchObject({eligible:false,reasons:['VISITS_INSUFFICIENT']});
 await expect(membershipTrial(pool,scope,cmd)).rejects.toMatchObject({code:'NOT_ELIGIBLE'});
 await pool.request().query('UPDATE dbo.TblClientLoyalty SET TotalVisits=3 WHERE ClientID=7');
 await expect(membershipTrial(pool,scope,{...cmd,expiresAt:new Date(Date.now()+86400000*4).toISOString()})).rejects.toMatchObject({code:'TRIAL_EXCEEDS_PROOF'});
 await expect(membershipTrial(pool,scope,{...cmd,programRevision:2})).rejects.toMatchObject({code:'PROGRAM_REVISION_CONFLICT'});
 await membershipTrial(pool,scope,cmd);
 await recordMembershipProof(pool,scope,{action:'REVOKE',accountId,kind:'STUDENT',expectedRevision:1,reason:'proof invalidated'});
 expect(await membershipTrial(pool,scope,{...cmd,action:'CHECK'})).toMatchObject({eligible:false,status:'INVALIDATED'});
 expect(await count()).toBe(1);
 });
 it('competing issuance cannot duplicate; suspended account cannot issue',async()=>{
 const cmd=command(),results=await Promise.allSettled([membershipTrial(pool,scope,cmd),membershipTrial(pool,scope,cmd)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'TRIAL_REVISION_CONFLICT'}});
 await pool.request().query(`UPDATE dbo.CutClubMemberAccount SET AccessStatus='SUSPENDED' WHERE AccountID='${accountId}'`);
 expect(await membershipTrial(pool,scope,{...cmd,action:'CHECK'})).toMatchObject({eligible:false,status:'INVALIDATED'});
 await expect(membershipTrial(pool,scope,{...cmd,expectedTrialRevision:1})).rejects.toMatchObject({code:'NOT_ELIGIBLE'});
 expect(await count()).toBe(1);
 });
});
