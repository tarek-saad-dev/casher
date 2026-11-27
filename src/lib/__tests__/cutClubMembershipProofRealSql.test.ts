import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import sql from 'mssql';
vi.mock('server-only',()=>({}));
import {lookupMembershipProof,recordMembershipProof} from '@/lib/cut-club/membershipProofSql';
import {pilotTenant} from '@/lib/cut-club/membershipDraft';
const enabled=process.env.CI==='true'&&process.env.MEMBERSHIP_EPHEMERAL_SQL==='1'&&process.env.MEMBERSHIP_EPHEMERAL_HOST==='127.0.0.1'&&!process.env.DB_SERVER&&!process.env.CLOUD_DB_SERVER;
const scope={tenantId:pilotTenant,staffId:71};
const accountId='22222222-2222-4222-8222-222222222222',foreign='33333333-3333-4333-8333-333333333333',phone='201000000000';
const approve=()=>({action:'APPROVE',accountId,kind:'STUDENT',expectedRevision:0,expectedClientId:7,reviewedInPerson:true,partnerCode:'UNI',expiresAt:new Date(Date.now()+86400000).toISOString(),reason:'reviewed in person'});
const revoke=(revision=1)=>({action:'REVOKE',accountId,kind:'STUDENT',expectedRevision:revision,reason:'proof invalidated'});
let pool:sql.ConnectionPool;
const read=()=>lookupMembershipProof(pool,scope,phone);
const count=async()=>(await pool.request().query('SELECT COUNT(*) AS C FROM dbo.CutClubMembershipProofEvent')).recordset[0].C;
describe.skipIf(!enabled)('membership proof real SQL on disposable fixture',()=>{
 beforeAll(async()=>{
 const password=process.env.MEMBERSHIP_EPHEMERAL_AGENT;if(!password)throw Error('MISSING_TEST_LOGIN');
 pool=await new sql.ConnectionPool({server:'127.0.0.1',port:1433,database:'last132_agent',user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true},pool:{max:6,min:0}}).connect();
 const c=await pool.request().query('SELECT DB_NAME() AS Db,SUSER_SNAME() AS LoginName');
 if(c.recordset[0]?.Db!=='last132_agent'||c.recordset[0]?.LoginName!=='drvo_agent')throw Error('WRONG_DB');
 });
 afterAll(async()=>{await pool?.close();});
 beforeEach(async()=>{
 process.env.CUT_CLUB_STAGING_MEMBERSHIP_PROOF_ENABLED='true';
 await pool.request().query(`DELETE dbo.CutClubMembershipProofEvent;
 UPDATE dbo.CutClubMemberAccount SET AccessStatus='ENABLED',LinkStatus='ACTIVE',LegacyClientID=7 WHERE AccountID='${accountId}';
 UPDATE dbo.TblClient SET Mobile='01000000000' WHERE ClientID=7;`);
 });
 it('approves evidence and revokes using new immutable revision with staff audit',async()=>{
 expect(await read()).toMatchObject({accountId,eligibleAccount:true,clientId:7,maskedPhone:'2010****000',proofs:[]});
 expect(await recordMembershipProof(pool,scope,approve())).toEqual({revision:1});
 expect((await read())?.proofs[0]).toMatchObject({revision:1,status:'VERIFIED',partnerCode:'UNI'});
 expect(await recordMembershipProof(pool,{...scope,staffId:72},revoke())).toEqual({revision:2});
 expect((await read())?.proofs[0]).toMatchObject({revision:2,status:'REVOKED',partnerCode:null});
 const rows=(await pool.request().query('SELECT Revision,Action,StaffID,Reason FROM dbo.CutClubMembershipProofEvent ORDER BY Revision')).recordset;
 expect(rows).toEqual([{Revision:1,Action:'APPROVE',StaffID:71,Reason:'reviewed in person'},{Revision:2,Action:'REVOKE',StaffID:72,Reason:'proof invalidated'}]);
 });
 it('fails closed on phone change, suspension or changed linked client and permits revocation',async()=>{
 await recordMembershipProof(pool,scope,approve());
 await pool.request().query("UPDATE dbo.TblClient SET Mobile='01200000000' WHERE ClientID=7");
 expect((await read())?.proofs[0].status).toBe('ACCOUNT_INELIGIBLE');
 await expect(recordMembershipProof(pool,scope,{...approve(),expectedRevision:1})).rejects.toMatchObject({code:'ACCOUNT_INELIGIBLE'});
 await pool.request().query("UPDATE dbo.TblClient SET Mobile='01000000000' WHERE ClientID=7");
 await pool.request().query(`UPDATE dbo.CutClubMemberAccount SET LegacyClientID=8 WHERE AccountID='${accountId}'`);
 expect((await read())?.proofs[0].status).toBe('ACCOUNT_INELIGIBLE');
 await expect(recordMembershipProof(pool,scope,{...approve(),expectedRevision:1})).rejects.toMatchObject({code:'ACCOUNT_INELIGIBLE'});
 await pool.request().query(`UPDATE dbo.CutClubMemberAccount SET AccessStatus='SUSPENDED' WHERE AccountID='${accountId}'`);
 expect((await read())?.eligibleAccount).toBe(false);
 expect(await recordMembershipProof(pool,scope,revoke())).toEqual({revision:2});
 expect((await read())?.proofs[0].status).toBe('REVOKED');
 });
 it('expires according to SQL UTC and never permits stale revisions',async()=>{
 await recordMembershipProof(pool,scope,approve());
 await pool.request().query('UPDATE dbo.CutClubMembershipProofEvent SET ExpiresAtUtc=DATEADD(SECOND,-1,SYSUTCDATETIME())');
 expect((await read())?.proofs[0].status).toBe('EXPIRED');
 await expect(recordMembershipProof(pool,scope,approve())).rejects.toMatchObject({code:'REVISION_CONFLICT'});
 expect(await count()).toBe(1);
 });
 it('concurrent approvals settle one revision, tenant and feature gate fail closed',async()=>{
 const result=await Promise.allSettled([recordMembershipProof(pool,scope,approve()),recordMembershipProof(pool,scope,approve())]);
 expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(result.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'REVISION_CONFLICT'}});
 expect(await lookupMembershipProof(pool,scope,'201000000001')).toBeNull();
 await expect(recordMembershipProof(pool,scope,{...approve(),accountId:foreign,expectedClientId:9})).rejects.toMatchObject({code:'ACCOUNT_NOT_FOUND'});
 await expect(recordMembershipProof(pool,{...scope,tenantId:'11111111-1111-4111-8111-111111111111'},approve())).rejects.toMatchObject({code:'PROOF_NOT_RELEASED'});
 process.env.CUT_CLUB_STAGING_MEMBERSHIP_PROOF_ENABLED='false';
 await expect(recordMembershipProof(pool,scope,revoke())).rejects.toMatchObject({code:'PROOF_NOT_RELEASED'});
 expect(await count()).toBe(1);
 });
});
