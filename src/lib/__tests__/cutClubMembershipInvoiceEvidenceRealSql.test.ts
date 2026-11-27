import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import sql from 'mssql';
import {createHash} from 'node:crypto';
vi.mock('server-only',()=>({}));
vi.mock('@/lib/cut-club/memberOtp',()=>({digestToken:(token:string)=>createHash('sha256').update('cutclub-member-session-v1:').update(token).digest('hex')}));
import {pilotTenant} from '@/lib/cut-club/membershipDraft';
import {saveMembershipDraft} from '@/lib/cut-club/membershipDraftSql';
import {publishMembership} from '@/lib/cut-club/membershipPublicationSql';
import {submitMembershipApplication,decideMembershipApplication} from '@/lib/cut-club/membershipApplicationSql';
import {membershipTrialFromApplication} from '@/lib/cut-club/membershipTrialSql';
import {saveBenefitDraft} from '@/lib/cut-club/membershipBenefitDraftSql';
import {recordBenefitApproval} from '@/lib/cut-club/membershipBenefitApprovalSql';
import {recordMembershipInvoiceEvidence,recordMembershipInvoiceEvidenceVoid} from '@/lib/cut-club/membershipInvoiceEvidenceSql';
import type {InvoiceEvidence} from '@/lib/cut-club/membershipInvoiceEvidence';
const enabled=process.env.CI==='true'&&process.env.MEMBERSHIP_EPHEMERAL_SQL==='1'&&process.env.MEMBERSHIP_EPHEMERAL_HOST==='127.0.0.1'&&!process.env.DB_SERVER&&!process.env.CLOUD_DB_SERVER;
const scope={tenantId:pilotTenant,staffId:71,branchId:1},accountId='22222222-2222-4222-8222-222222222222',token='E'.repeat(43);
const program={code:'EVIDENCE_SQL',expectedRevision:0,title:'Evidence fixture',kind:'GENERAL',minimumVisits:2,allowedBranchIds:[1],partnerCode:null,reason:'fixture rules'};
const rule={code:'HAIR',kind:'PERCENT_DISCOUNT',serviceId:9,value:1000,maxUsesPerMembership:3,maxUsesPerInvoice:2,branchIds:[1]};
const evidence:InvoiceEvidence={invoiceId:90001,accountId,programCode:program.code,trialRevision:1,approvalRevision:1,clientId:7,branchId:1,businessDayId:4,shiftMoveId:5,serviceId:9,units:1,lineGrossMinor:20001,lineDiscountMinor:2000,lineNetMinor:18001,invoiceGrossMinor:20001,invoiceNetMinor:18001};
let pool:sql.ConnectionPool;
describe.skipIf(!enabled)('invoice evidence transaction, disposable SQL only',()=>{
 beforeAll(async()=>{
 const password=process.env.MEMBERSHIP_EPHEMERAL_AGENT;if(!password)throw Error('MISSING_TEST_LOGIN');
 pool=await new sql.ConnectionPool({server:'127.0.0.1',port:1433,database:'last132_agent',user:'drvo_agent',password,options:{encrypt:false,trustServerCertificate:true},pool:{max:6,min:0}}).connect();
 const c=await pool.request().query('SELECT DB_NAME() AS Db,SUSER_SNAME() AS LoginName');
 if(c.recordset[0]?.Db!=='last132_agent'||c.recordset[0]?.LoginName!=='drvo_agent')throw Error('WRONG_DB');
 for(const k of ['DRAFT','PUBLICATION','TRIAL','APPLICATION','APPLICATION_ISSUE','BENEFIT_DRAFT','BENEFIT_APPROVAL','INVOICE_EVIDENCE'])process.env['CUT_CLUB_STAGING_MEMBERSHIP_'+k+'_ENABLED']='true';
 const digest=createHash('sha256').update('cutclub-member-session-v1:').update(token).digest('hex');
 await pool.request().input('account',sql.UniqueIdentifier,accountId).input('tenant',sql.UniqueIdentifier,pilotTenant).input('digest',sql.Char(64),digest).query(`
 UPDATE dbo.CutClubMemberAccount SET AccessStatus='ENABLED',LinkStatus='ACTIVE',LegacyClientID=7 WHERE AccountID=@account AND TenantId=@tenant;
 UPDATE dbo.TblClient SET Mobile='01000000000' WHERE ClientID=7 AND TenantId=@tenant;
 UPDATE dbo.TblClientLoyalty SET TotalVisits=3 WHERE ClientID=7;
 INSERT dbo.CutClubCustomerSession VALUES(@digest,@tenant,@account,NULL,DATEADD(MINUTE,20,SYSUTCDATETIME()));`);
 await saveMembershipDraft(pool,scope,program);
 await publishMembership(pool,scope,{action:'PUBLISH',code:program.code,programRevision:1,expectedRevision:0,reason:'publish test'});
 const application=await submitMembershipApplication(pool,token,{code:program.code,publicationRevision:1,branchId:1});
 await decideMembershipApplication(pool,scope,{id:application.id,decision:'ACCEPTED_FOR_REVIEW',reason:'review accepted'});
 await membershipTrialFromApplication(pool,scope,{applicationId:application.id,action:'ISSUE',expectedTrialRevision:0,expiresAt:new Date(Date.now()+86400000).toISOString(),reason:'issue trial'});
 await saveBenefitDraft(pool,scope,{programCode:program.code,programRevision:1,expectedRevision:0,reason:'proposal only',rules:[rule]});
 await recordBenefitApproval(pool,scope,{action:'APPROVE',programCode:program.code,programRevision:1,publicationRevision:1,benefitRevision:1,expectedRevision:0,reason:'review complete'});
 });
 afterAll(async()=>{await pool?.close();});
 async function fixture(tx:sql.Transaction,id:number){
 await new sql.Request(tx).input('id',sql.Int,id).query(`
 INSERT dbo.TblinvServHead VALUES(@id,N'مبيعات',7,1,4,5,71,200.01,180.01,0,0,0,0,180.01,0);
 INSERT dbo.TblinvServDetail VALUES(@id,N'مبيعات',9,1,200.01,20,180.01);
 INSERT dbo.TblinvServPayment VALUES(@id,N'مبيعات',180.01);`);
 }
 async function count(id:number){const r=await pool.request().input('id',sql.Int,id).query('SELECT (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE invID=@id) AS H,(SELECT COUNT(*) FROM dbo.CutClubMembershipInvoiceEvidence WHERE InvoiceID=@id) AS E');return r.recordset[0];}
 it('rolls back evidence and invoice together, rejects mismatches, and binds committed invoice once',async()=>{
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{await fixture(tx,evidence.invoiceId);await expect(recordMembershipInvoiceEvidence(tx,scope,{...evidence,clientId:8})).rejects.toMatchObject({code:'INVOICE_NOT_MATCHED'});expect(await recordMembershipInvoiceEvidence(tx,scope,evidence)).toEqual({invoiceId:evidence.invoiceId,evidenceOnly:true});}finally{await tx.rollback();}
 expect(await count(evidence.invoiceId)).toEqual({H:0,E:0});
 const committed=new sql.Transaction(pool);await committed.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{await fixture(committed,evidence.invoiceId);await recordMembershipInvoiceEvidence(committed,scope,evidence);await committed.commit();}catch(e){await committed.rollback().catch(()=>{});throw e;}
 expect(await count(evidence.invoiceId)).toEqual({H:1,E:1});
 const duplicate=new sql.Transaction(pool);await duplicate.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{await expect(recordMembershipInvoiceEvidence(duplicate,scope,evidence)).rejects.toMatchObject({code:'INVOICE_ALREADY_BOUND'});await expect(recordMembershipInvoiceEvidenceVoid(duplicate,scope,evidence.invoiceId,'void requested')).rejects.toMatchObject({code:'INVOICE_STILL_PRESENT'});}finally{await duplicate.rollback();}
 });
});
