import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import sql from 'mssql';
vi.mock('server-only',()=>({}));
import {saveMembershipDraft,listMembershipDrafts} from '@/lib/cut-club/membershipDraftSql';
import {pilotTenant} from '@/lib/cut-club/membershipDraft';
const enabled=process.env.CI==='true'&&process.env.MEMBERSHIP_EPHEMERAL_SQL==='1'&&process.env.MEMBERSHIP_EPHEMERAL_HOST==='127.0.0.1'&&!process.env.DB_SERVER&&!process.env.CLOUD_DB_SERVER;
const scope={tenantId:pilotTenant,staffId:71};
const valid={code:'STUDENTS_01',expectedRevision:0,title:'طلاب',kind:'STUDENT',minimumVisits:0,allowedBranchIds:[1,3],partnerCode:'UNI',reason:'initial draft'};
let pool:sql.ConnectionPool;
describe.skipIf(!enabled)('real SQL: membership drafts isolated from live membership and wallet',()=>{
 beforeAll(async()=>{
  const password=process.env.MEMBERSHIP_EPHEMERAL_AGENT;if(!password)throw Error('MISSING_TEST_LOGIN');
  pool=await new sql.ConnectionPool({server:'127.0.0.1',port:1433,database:'last132_agent',user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true},pool:{max:6,min:0}}).connect();
  const check=await pool.request().query("SELECT DB_NAME() AS Db,SUSER_SNAME() AS LoginName");
  if(check.recordset[0]?.Db!=='last132_agent'||check.recordset[0]?.LoginName!=='drvo_agent')throw Error('WRONG_DB');
 });
 afterAll(async()=>{await pool?.close();});
 beforeEach(async()=>{
  process.env.CUT_CLUB_STAGING_MEMBERSHIP_DRAFT_ENABLED='true';
  await pool.request().query('DELETE dbo.CutClubMembershipProgramDraft');
 });
 it('appends revisions with audit and reads latest only',async()=>{
  const first=await saveMembershipDraft(pool,scope,valid);expect(first).toMatchObject({code:valid.code,revision:1,allowedBranchIds:[1,3]});
  const second=await saveMembershipDraft(pool,{...scope,staffId:72},{...valid,expectedRevision:1,title:'طلاب جامعة',reason:'update scope',allowedBranchIds:[3]});
  expect(second).toMatchObject({revision:2,allowedBranchIds:[3]});
  expect(await listMembershipDrafts(pool,scope)).toEqual([second]);
  const rows=(await pool.request().query('SELECT Revision,CreatedBy,Reason FROM dbo.CutClubMembershipProgramDraft ORDER BY Revision')).recordset;
  expect(rows).toEqual([{Revision:1,CreatedBy:71,Reason:'initial draft'},{Revision:2,CreatedBy:72,Reason:'update scope'}]);
 });
 it('concurrent saves cannot overwrite a newer revision',async()=>{
  await saveMembershipDraft(pool,scope,valid);
  const results=await Promise.allSettled([saveMembershipDraft(pool,scope,{...valid,expectedRevision:1,title:'A'}),saveMembershipDraft(pool,scope,{...valid,expectedRevision:1,title:'B'})]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const denied=results.find(x=>x.status==='rejected');expect(denied).toMatchObject({reason:{code:'REVISION_CONFLICT'}});
  expect((await listMembershipDrafts(pool,scope))[0].revision).toBe(2);
  expect((await pool.request().query('SELECT COUNT(*) AS C FROM dbo.CutClubMembershipProgramDraft')).recordset[0].C).toBe(2);
 });
 it('rejects disabled flag, foreign tenant and activation payload without writes',async()=>{
  await expect(saveMembershipDraft(pool,{...scope,tenantId:'11111111-1111-4111-8111-111111111111'},valid)).rejects.toMatchObject({code:'DRAFT_NOT_RELEASED'});
  await expect(saveMembershipDraft(pool,scope,{...valid,enabled:true})).rejects.toMatchObject({code:'INVALID_DRAFT'});
  process.env.CUT_CLUB_STAGING_MEMBERSHIP_DRAFT_ENABLED='false';
  await expect(saveMembershipDraft(pool,scope,valid)).rejects.toMatchObject({code:'DRAFT_NOT_RELEASED'});
  expect((await pool.request().query('SELECT COUNT(*) AS C FROM dbo.CutClubMembershipProgramDraft')).recordset[0].C).toBe(0);
 });
});
