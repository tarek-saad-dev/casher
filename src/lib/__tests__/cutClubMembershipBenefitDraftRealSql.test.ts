import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import sql from 'mssql';
vi.mock('server-only',()=>({}));
import {pilotTenant} from '@/lib/cut-club/membershipDraft';
import {saveMembershipDraft} from '@/lib/cut-club/membershipDraftSql';
import {saveBenefitDraft,listBenefitDrafts,listBenefitCatalog} from '@/lib/cut-club/membershipBenefitDraftSql';
const enabled=process.env.CI==='true'&&process.env.MEMBERSHIP_EPHEMERAL_SQL==='1'&&process.env.MEMBERSHIP_EPHEMERAL_HOST==='127.0.0.1'&&!process.env.DB_SERVER&&!process.env.CLOUD_DB_SERVER;
const scope={tenantId:pilotTenant,staffId:71};
const program={code:'BENEFITS_SQL',expectedRevision:0,title:'Synthetic benefits',kind:'GENERAL',minimumVisits:0,allowedBranchIds:[1],partnerCode:null,reason:'fixture only'};
const rule={code:'HAIR',kind:'PERCENT_DISCOUNT',serviceId:9,value:1000,maxUsesPerMembership:3,maxUsesPerInvoice:1,branchIds:[1]};
const input={programCode:program.code,programRevision:1,expectedRevision:0,reason:'proposal only',rules:[rule]};
let pool:sql.ConnectionPool;
describe.skipIf(!enabled)('benefit draft revision lifecycle, disposable SQL only',()=>{
 beforeAll(async()=>{
 const password=process.env.MEMBERSHIP_EPHEMERAL_AGENT;if(!password)throw Error('MISSING_TEST_LOGIN');
 pool=await new sql.ConnectionPool({server:'127.0.0.1',port:1433,database:'last132_agent',user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true},pool:{max:6,min:0}}).connect();
 const c=await pool.request().query('SELECT DB_NAME() AS Db,SUSER_SNAME() AS LoginName');
 if(c.recordset[0]?.Db!=='last132_agent'||c.recordset[0]?.LoginName!=='drvo_agent')throw Error('WRONG_DB');
 process.env.CUT_CLUB_STAGING_MEMBERSHIP_DRAFT_ENABLED='true';
 process.env.CUT_CLUB_STAGING_MEMBERSHIP_BENEFIT_DRAFT_ENABLED='true';
 });
 afterAll(async()=>{await pool?.close();});
 it('loads only eligible tenant services and authoritative minor units',async()=>{
 expect(await listBenefitCatalog(pool,scope)).toEqual([{id:9,name:'حلاقة',priceMinor:20001}]);
 await expect(listBenefitCatalog(pool,{...scope,tenantId:'11111111-1111-4111-8111-111111111111'})).rejects.toMatchObject({code:'BENEFITS_NOT_RELEASED'});
 });
 it('enforces branch scope, records immutable revisions, rejects concurrent replay and hides stale versions',async()=>{
 await saveMembershipDraft(pool,scope,program);
 await expect(saveBenefitDraft(pool,scope,{...input,rules:[{...rule,branchIds:[3]}]})).rejects.toMatchObject({code:'BENEFIT_BRANCH_OUTSIDE_PROGRAM'});
 await expect(saveBenefitDraft(pool,scope,{...input,rules:[{...rule,value:10001}]})).rejects.toMatchObject({code:'INVALID_BENEFIT_DRAFT'});
 const results=await Promise.allSettled([saveBenefitDraft(pool,scope,input),saveBenefitDraft(pool,scope,input)]);
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 expect(results.find(x=>x.status==='rejected')).toMatchObject({reason:{code:'BENEFIT_REVISION_CONFLICT'}});
 expect((await listBenefitDrafts(pool,scope)).find(x=>x.programCode===program.code)).toMatchObject({revision:1,rules:[rule]});
 await saveBenefitDraft(pool,{...scope,staffId:72},{...input,expectedRevision:1,rules:[],reason:'remove proposal'});
 expect((await listBenefitDrafts(pool,scope)).find(x=>x.programCode===program.code)).toMatchObject({revision:2,rules:[]});
 const history=await pool.request().input('tenant',sql.UniqueIdentifier,pilotTenant).input('code',sql.VarChar(40),program.code).query('SELECT Revision,StaffID,Reason FROM dbo.CutClubMembershipBenefitDraft WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision');
 expect(history.recordset).toEqual([{Revision:1,StaffID:71,Reason:'proposal only'},{Revision:2,StaffID:72,Reason:'remove proposal'}]);
 await saveMembershipDraft(pool,scope,{...program,expectedRevision:1,reason:'new program revision'});
 expect((await listBenefitDrafts(pool,scope)).find(x=>x.programCode===program.code)).toBeUndefined();
 await expect(saveBenefitDraft(pool,scope,{...input,expectedRevision:2})).rejects.toMatchObject({code:'PROGRAM_REVISION_CONFLICT'});
 process.env.CUT_CLUB_STAGING_MEMBERSHIP_BENEFIT_DRAFT_ENABLED='false';
 await expect(listBenefitDrafts(pool,scope)).rejects.toMatchObject({code:'BENEFITS_NOT_RELEASED'});
 });
});
