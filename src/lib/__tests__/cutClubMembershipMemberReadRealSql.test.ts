import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import sql from 'mssql';
import {createHash} from 'node:crypto';
vi.mock('server-only',()=>({}));
vi.mock('@/lib/cut-club/memberOtp',()=>({digestToken:(token:string)=>createHash('sha256').update('cutclub-member-session-v1:').update(token).digest('hex')}));
import {readMembershipTrials} from '@/lib/cut-club/memberMembershipRead';
import {saveMembershipDraft} from '@/lib/cut-club/membershipDraftSql';
import {recordMembershipProof} from '@/lib/cut-club/membershipProofSql';
import {membershipTrial} from '@/lib/cut-club/membershipTrialSql';
import {pilotTenant} from '@/lib/cut-club/membershipDraft';
const enabled=process.env.CI==='true'&&process.env.MEMBERSHIP_EPHEMERAL_SQL==='1'&&process.env.MEMBERSHIP_EPHEMERAL_HOST==='127.0.0.1'&&!process.env.DB_SERVER&&!process.env.CLOUD_DB_SERVER;
const scope={tenantId:pilotTenant,staffId:71},accountId='22222222-2222-4222-8222-222222222222',token='A'.repeat(43),other='B'.repeat(43);
const digest=(t:string)=>createHash('sha256').update('cutclub-member-session-v1:').update(t).digest('hex');
const draft={code:'STUDENT_01',expectedRevision:0,title:'طلاب',kind:'STUDENT',minimumVisits:2,allowedBranchIds:[1,3],partnerCode:'UNI',reason:'initial draft'};
let pool:sql.ConnectionPool;
const read=()=>readMembershipTrials(pool,token);
describe.skipIf(!enabled)('member membership read with persisted opaque SQL session',()=>{
 beforeAll(async()=>{
 const password=process.env.MEMBERSHIP_EPHEMERAL_AGENT;if(!password)throw Error('MISSING_TEST_LOGIN');
 pool=await new sql.ConnectionPool({server:'127.0.0.1',port:1433,database:'last132_agent',user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true},pool:{max:6,min:0}}).connect();
 const c=await pool.request().query('SELECT DB_NAME() AS Db,SUSER_SNAME() AS LoginName');
 if(c.recordset[0]?.Db!=='last132_agent'||c.recordset[0]?.LoginName!=='drvo_agent')throw Error('WRONG_DB');
 });
 afterAll(async()=>{if(pool){try{await pool.request().query('DELETE dbo.CutClubMembershipTrial; DELETE dbo.CutClubCustomerSession');}finally{await pool.close();}}});
 beforeEach(async()=>{
 for(const name of ['DRAFT','PROOF','TRIAL','MEMBER_READ'])process.env['CUT_CLUB_STAGING_MEMBERSHIP_'+name+'_ENABLED']='true';
 await pool.request().query(`DELETE dbo.CutClubMembershipTrial; DELETE dbo.CutClubMembershipProgramDraft; DELETE dbo.CutClubMembershipProofEvent; DELETE dbo.CutClubCustomerSession;
 UPDATE dbo.CutClubMemberAccount SET AccessStatus='ENABLED',LinkStatus='ACTIVE',LegacyClientID=7 WHERE AccountID='${accountId}';
 UPDATE dbo.TblClient SET Mobile='01000000000' WHERE ClientID=7;
 UPDATE dbo.TblClientLoyalty SET TotalVisits=3 WHERE ClientID=7;
 INSERT dbo.CutClubCustomerSession VALUES('${digest(token)}','${pilotTenant}','${accountId}',NULL,DATEADD(MINUTE,20,SYSUTCDATETIME())),
 ('${digest(other)}','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',NULL,DATEADD(MINUTE,20,SYSUTCDATETIME()));`);
 await saveMembershipDraft(pool,scope,draft);
 await saveMembershipDraft(pool,scope,{...draft,code:'UNISSUED'});
 await recordMembershipProof(pool,scope,{action:'APPROVE',accountId,kind:'STUDENT',expectedRevision:0,expectedClientId:7,reviewedInPerson:true,partnerCode:'UNI',expiresAt:new Date(Date.now()+86400000*3).toISOString(),reason:'reviewed in person'});
 await membershipTrial(pool,scope,{action:'ISSUE',accountId,programCode:draft.code,programRevision:1,branchId:1,expectedTrialRevision:0,expiresAt:new Date(Date.now()+86400000).toISOString(),reason:'isolated trial'});
 });
 it('returns only issued trials and never private metadata or benefits',async()=>{
 const result=await read();expect(result).toMatchObject({ok:true,trialOnly:true,enrollmentEnabled:false,accountStatus:'ACTIVE'});
 expect(result.items).toHaveLength(1);
 expect(result.items[0]).toEqual({code:draft.code,title:draft.title,kind:'STUDENT',status:'CURRENT',expiresAt:expect.any(String),branchId:1,benefitsEnabled:false});
 await expect(readMembershipTrials(pool,other)).rejects.toMatchObject({code:'SESSION_REQUIRED'});
 await expect(readMembershipTrials(pool,'bad')).rejects.toMatchObject({code:'SESSION_REQUIRED'});
 });
 it('rechecks proof, program and visits, never returns active on revocation',async()=>{
 await recordMembershipProof(pool,scope,{action:'REVOKE',accountId,kind:'STUDENT',expectedRevision:1,reason:'proof invalidated'});
 expect((await read()).items[0].status).toBe('INVALIDATED');
 await pool.request().query('UPDATE dbo.CutClubMembershipTrial SET ExpiresAtUtc=DATEADD(SECOND,-1,SYSUTCDATETIME())');
 expect((await read()).items[0].status).toBe('EXPIRED');
 });
 it('hides rows from suspended or relinked accounts and denies revoked sessions',async()=>{
 await pool.request().query(`UPDATE dbo.CutClubMemberAccount SET AccessStatus='SUSPENDED' WHERE AccountID='${accountId}'`);
 expect(await read()).toMatchObject({accountStatus:'SUSPENDED',items:[]});
 await pool.request().query(`UPDATE dbo.CutClubMemberAccount SET AccessStatus='ENABLED',LegacyClientID=8 WHERE AccountID='${accountId}'`);
 expect((await read()).items).toEqual([]);
 await pool.request().query('UPDATE dbo.CutClubCustomerSession SET RevokedAtUtc=SYSUTCDATETIME()');
 await expect(read()).rejects.toMatchObject({code:'SESSION_REQUIRED'});
 });
 it('fails closed when gate is disabled',async()=>{
 process.env.CUT_CLUB_STAGING_MEMBERSHIP_MEMBER_READ_ENABLED='false';
 await expect(read()).rejects.toMatchObject({code:'MEMBERSHIPS_NOT_RELEASED'});
 });
});
