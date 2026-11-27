import 'server-only';
import sql from 'mssql';
import {pilotTenant} from './membershipDraft';
import {evaluateMembershipEligibility,type MembershipKind,type MemberFacts} from './membershipPolicy';
import {parseTrialInput,parseApplicationTrialInput,type TrialInput,type ApplicationTrialInput,type TrialResult} from './membershipTrial';
export class TrialError extends Error{constructor(public code:string,public status:number){super(code);}}
type Scope={tenantId:string;staffId:number};
async function gate(r:sql.Request,s:Scope){
 if(s.tenantId.toLowerCase()!==pilotTenant||!Number.isSafeInteger(s.staffId)||s.staffId<=0||process.env.CUT_CLUB_STAGING_MEMBERSHIP_TRIAL_ENABLED!=='true')throw new TrialError('TRIAL_NOT_RELEASED',403);
 const x=await r.input('tenant',sql.UniqueIdentifier,s.tenantId).query<{Ready:number}>(`SELECT CASE WHEN DB_NAME()='last132_agent' AND SUSER_SNAME()='drvo_agent'
 AND OBJECT_ID(N'dbo.CutClubMembershipTrial',N'U') IS NOT NULL AND COL_LENGTH(N'dbo.CutClubMemberAccount',N'AccessStatus') IS NOT NULL
 AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code='CASHER_BOOT' AND Status='active') THEN 1 ELSE 0 END AS Ready`);
 if(x.recordset[0]?.Ready!==1)throw new TrialError('TRIAL_SCHEMA_UNAVAILABLE',503);
}
export async function membershipTrial(pool:sql.ConnectionPool,s:Scope,raw:unknown):Promise<TrialResult>{
 const v=parseTrialInput(raw);if(!v)throw new TrialError('INVALID_TRIAL',400);
 return runTrial(pool,s,v,null);
}
export async function membershipTrialFromApplication(pool:sql.ConnectionPool,s:Scope,raw:unknown):Promise<TrialResult>{
 const input=parseApplicationTrialInput(raw);if(!input)throw new TrialError('INVALID_TRIAL',400);
 return runTrial(pool,s,null,input);
}
async function runTrial(pool:sql.ConnectionPool,s:Scope,manual:TrialInput|null,application:ApplicationTrialInput|null):Promise<TrialResult>{
 await gate(pool.request(),s);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
 await gate(new sql.Request(tx),s);
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,s.tenantId);
 let v=manual;let applicationClient:number|null=null;
 if(application){
  if(process.env.CUT_CLUB_STAGING_MEMBERSHIP_APPLICATION_ENABLED!=='true'||process.env.CUT_CLUB_STAGING_MEMBERSHIP_PUBLICATION_ENABLED!=='true'||process.env.CUT_CLUB_STAGING_MEMBERSHIP_APPLICATION_ISSUE_ENABLED!=='true')throw new TrialError('APPLICATION_ISSUE_NOT_RELEASED',403);
  const lock=await new sql.Request(tx).input('lock',sql.NVarChar(200),'CUTCLUB:MEMBERSHIP_DRAFT:'+s.tenantId.toLowerCase()).query<{Result:number}>(`DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000; SELECT @r AS Result;`);
  if(lock.recordset[0]?.Result===undefined||lock.recordset[0].Result<0)throw new TrialError('APPLICATION_BUSY',409);
  const rr=await q().input('id',sql.UniqueIdentifier,application.applicationId).query<{AccountID:string;LegacyClientID:number;ProgramCode:string;ProgramRevision:number;BranchID:1|3;Consumed:number}>(`
   SELECT a.AccountID,a.LegacyClientID,a.ProgramCode,p.ProgramRevision,a.BranchID,
   CASE WHEN f.ApplicationID IS NULL THEN 0 ELSE 1 END AS Consumed
   FROM dbo.CutClubMembershipApplication a WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.CutClubMembershipApplicationDecision d WITH(HOLDLOCK) ON d.TenantId=a.TenantId AND d.ApplicationID=a.ApplicationID AND d.Decision='ACCEPTED_FOR_REVIEW'
   CROSS APPLY(SELECT TOP(1) Revision,ProgramRevision,Action FROM dbo.CutClubMembershipPublication WITH(HOLDLOCK) WHERE TenantId=a.TenantId AND ProgramCode=a.ProgramCode ORDER BY Revision DESC) p
   LEFT JOIN dbo.CutClubMembershipApplicationFulfillment f WITH(HOLDLOCK) ON f.TenantId=a.TenantId AND f.ApplicationID=a.ApplicationID
   WHERE a.TenantId=@tenant AND a.ApplicationID=@id AND p.Action='PUBLISH' AND p.Revision=a.PublicationRevision`);
  if(rr.recordset.length!==1)throw new TrialError('APPLICATION_NOT_ACCEPTED_OR_CURRENT',409);
  const a=rr.recordset[0];if(a.Consumed===1)throw new TrialError('APPLICATION_ALREADY_FULFILLED',409);
  applicationClient=a.LegacyClientID;
  v={action:application.action,accountId:a.AccountID,programCode:a.ProgramCode,programRevision:a.ProgramRevision,branchId:a.BranchID,expectedTrialRevision:application.expectedTrialRevision,expiresAt:application.expiresAt,reason:application.reason};
 }
 if(!v)throw new TrialError('INVALID_TRIAL',400);
 const ar=await q().input('account',sql.UniqueIdentifier,v.accountId).query<{LegacyClientID:number|null;Eligible:number}>(`
 SELECT a.LegacyClientID,CASE WHEN a.LinkStatus='ACTIVE' AND a.AccessStatus='ENABLED' AND EXISTS(
 SELECT 1 FROM dbo.TblClient c WITH(HOLDLOCK)
 CROSS APPLY(SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.Mobile)),' ',''),'-',''),'+',''),'(',''),')','') AS M) cleaned
 WHERE c.TenantId=a.TenantId AND c.ClientID=a.LegacyClientID AND a.PhoneNormalized=CASE WHEN LEN(cleaned.M)=11 AND cleaned.M LIKE '01[0125]%' THEN '2'+cleaned.M WHEN LEN(cleaned.M)=14 AND cleaned.M LIKE '00201[0125]%' THEN SUBSTRING(cleaned.M,3,12) ELSE cleaned.M END)
 THEN 1 ELSE 0 END AS Eligible
 FROM dbo.CutClubMemberAccount a WITH(UPDLOCK,HOLDLOCK) WHERE a.TenantId=@tenant AND a.AccountID=@account`);
 if(ar.recordset.length!==1)throw new TrialError('ACCOUNT_NOT_FOUND',404);
 const a=ar.recordset[0];
 if(application&&a.LegacyClientID!==applicationClient)throw new TrialError('APPLICATION_ACCOUNT_CHANGED',409);
 const dr=await q().input('code',sql.VarChar(40),v.programCode).query<{Revision:number;Kind:MembershipKind;MinimumVisits:number;Gleem:boolean;CampShizar:boolean;PartnerCode:string|null}>(`
 SELECT TOP(1) Revision,Kind,MinimumVisits,Gleem,CampShizar,PartnerCode FROM dbo.CutClubMembershipProgramDraft WITH(HOLDLOCK)
 WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision DESC`);
 const d=dr.recordset[0];if(!d||d.Revision!==v.programRevision)throw new TrialError('PROGRAM_REVISION_CONFLICT',409);
 const now=(await new sql.Request(tx).query<{Now:Date}>('SELECT SYSUTCDATETIME() AS Now')).recordset[0].Now;
 let visits:number|null=null;let proof:MemberFacts['proof']=null;let proofRevision:number|null=null;
 if(a.Eligible===1&&a.LegacyClientID){
 const lr=await q().input('client',sql.Int,a.LegacyClientID).query<{TotalVisits:number|null}>(`
 SELECT TOP(2) l.TotalVisits FROM dbo.TblClientLoyalty l WITH(HOLDLOCK)
 JOIN dbo.TblClient c WITH(HOLDLOCK) ON c.ClientID=l.ClientID AND c.TenantId=@tenant
 WHERE l.ClientID=@client AND l.IsActive=1`);
 const n=lr.recordset[0]?.TotalVisits;
 if(lr.recordset.length===1&&typeof n==='number'&&Number.isSafeInteger(n)&&n>=0)visits=n;
 if(d.Kind!=='GENERAL'){
 const pr=await q().input('account',sql.UniqueIdentifier,v.accountId).input('kind',sql.VarChar(16),d.Kind).query<{Revision:number;Action:string;LegacyClientID:number;PartnerCode:string|null;ExpiresAtUtc:Date|null}>(`
 SELECT TOP(1) Revision,Action,LegacyClientID,PartnerCode,ExpiresAtUtc FROM dbo.CutClubMembershipProofEvent WITH(HOLDLOCK)
 WHERE TenantId=@tenant AND AccountID=@account AND Kind=@kind ORDER BY Revision DESC`);
 const e=pr.recordset[0];
 if(e?.Action==='APPROVE'&&e.LegacyClientID===a.LegacyClientID){proofRevision=e.Revision;proof={kind:d.Kind,verified:true,partnerCode:e.PartnerCode,expiresAt:e.ExpiresAtUtc?.toISOString()??null};}
 }
 }
 const eligibility=evaluateMembershipEligibility({kind:d.Kind,enabled:true,minimumVisits:d.MinimumVisits,allowedBranchIds:[...(d.Gleem?[1]:[]),...(d.CampShizar?[3]:[])],partnerCode:d.PartnerCode},{accountStatus:a.Eligible===1?'ACTIVE':'REVIEW_REQUIRED',completedVisits:visits,branchId:v.branchId,proof},now);
 const old=await q().input('account',sql.UniqueIdentifier,v.accountId).input('code',sql.VarChar(40),v.programCode).query<{Revision:number;ProgramRevision:number;LegacyClientID:number;BranchID:number;ProofRevision:number|null;ExpiresAtUtc:Date}>(`
 SELECT TOP(1) Revision,ProgramRevision,LegacyClientID,BranchID,ProofRevision,ExpiresAtUtc FROM dbo.CutClubMembershipTrial WITH(UPDLOCK,HOLDLOCK)
 WHERE TenantId=@tenant AND AccountID=@account AND ProgramCode=@code ORDER BY Revision DESC`);
 const prior=old.recordset[0],revision=prior?.Revision??0;
 const status:TrialResult['status']=!prior?'NONE':prior.ExpiresAtUtc<=now?'EXPIRED':!eligibility.eligible||prior.ProgramRevision!==d.Revision||prior.LegacyClientID!==a.LegacyClientID||prior.ProofRevision!==proofRevision?'INVALIDATED':'CURRENT';
 const result:TrialResult={...eligibility,visits,proofRevision,trialRevision:revision,status,issued:false};
 if(v.action==='CHECK'){await tx.commit();return result;}
 if(revision!==v.expectedTrialRevision)throw new TrialError('TRIAL_REVISION_CONFLICT',409);
 if(!eligibility.eligible||!a.LegacyClientID)throw new TrialError('NOT_ELIGIBLE',409);
 if(status==='CURRENT'||(prior&&prior.ExpiresAtUtc>now&&prior.ProgramRevision===d.Revision&&prior.LegacyClientID===a.LegacyClientID&&prior.ProofRevision===proofRevision))throw new TrialError('TRIAL_ALREADY_CURRENT',409);
 // Cannot extend beyond evidence validity. General trial is also capped by validated input.
 if(proof&&(!proof.expiresAt||Date.parse(v.expiresAt)>Date.parse(proof.expiresAt)))throw new TrialError('TRIAL_EXCEEDS_PROOF',409);
 const written=await q().input('account',sql.UniqueIdentifier,v.accountId).input('code',sql.VarChar(40),v.programCode)
 .input('rev',sql.Int,revision+1).input('programRev',sql.Int,d.Revision).input('client',sql.Int,a.LegacyClientID)
 .input('branch',sql.Int,v.branchId).input('proofRev',sql.Int,proofRevision).input('expires',sql.DateTime2,new Date(v.expiresAt))
 .input('staff',sql.Int,s.staffId).input('reason',sql.NVarChar(300),v.reason).query(`
 INSERT dbo.CutClubMembershipTrial(TenantId,AccountID,ProgramCode,Revision,ProgramRevision,LegacyClientID,BranchID,ProofRevision,ExpiresAtUtc,StaffID,Reason)
 SELECT @tenant,@account,@code,@rev,@programRev,@client,@branch,@proofRev,@expires,@staff,@reason WHERE @expires>SYSUTCDATETIME()`);
 if(written.rowsAffected[0]!==1)throw new TrialError('TRIAL_EXPIRED',409);
 if(application){const f=await q().input('id',sql.UniqueIdentifier,application.applicationId).input('account',sql.UniqueIdentifier,v.accountId).input('code',sql.VarChar(40),v.programCode).input('revision',sql.Int,revision+1).query(`INSERT dbo.CutClubMembershipApplicationFulfillment(TenantId,ApplicationID,AccountID,ProgramCode,TrialRevision) VALUES(@tenant,@id,@account,@code,@revision)`);if(f.rowsAffected[0]!==1)throw new TrialError('APPLICATION_FULFILLMENT_FAILED',503);}
 await tx.commit();return {...result,trialRevision:revision+1,status:'CURRENT',issued:true};
 }catch(e){await tx.rollback().catch(()=>{});throw e;}
}
