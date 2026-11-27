import 'server-only';
import sql from 'mssql';
import {pilotTenant} from './membershipDraft';
import {parseUsageInput,parseUsageReversal} from './membershipBenefitUsage';
import {parseBenefitDraft} from './membershipBenefitDraft';
import {evaluateMembershipEligibility,type MembershipKind,type MemberFacts} from './membershipPolicy';
import {readBenefitCatalog} from './membershipBenefitDraftSql';
import {previewBenefit} from './membershipBenefitPreview';
export class BenefitUsageError extends Error{constructor(public code:string,public status:number){super(code);}}
type Scope={tenantId:string;staffId:number};
type Trial={Revision:number;ProgramRevision:number;LegacyClientID:number;BranchID:number;ProofRevision:number|null;ExpiresAtUtc:Date;Kind:MembershipKind;MinimumVisits:number;Gleem:boolean;CampShizar:boolean;PartnerCode:string|null;LatestProgram:number;PublicationRevision:number;ApprovalRevision:number;BenefitRevision:number;RulesJson:string;Reason:string};
type Usage={AccountID:string;ProgramCode:string;TrialRevision:number;ApprovalRevision:number;LegacyClientID:number;ServiceID:number;BranchID:number;Units:number;OriginalMinor:number;DiscountMinor:number;FinalMinor:number;BonusCoins:number;Reversed:number};
const fail=(code:string,status=409):never=>{throw new BenefitUsageError(code,status);};
async function run<T>(pool:sql.ConnectionPool,s:Scope,fn:(tx:sql.Transaction)=>Promise<T>):Promise<T>{
 if(s.tenantId.toLowerCase()!==pilotTenant||!Number.isSafeInteger(s.staffId)||s.staffId<=0||process.env.CUT_CLUB_STAGING_MEMBERSHIP_BENEFIT_USAGE_ENABLED!=='true')fail('USAGE_NOT_RELEASED',403);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
 const g=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,s.tenantId).query<{Ready:number}>(`SELECT CASE WHEN DB_NAME()='last132_agent' AND SUSER_SNAME()='drvo_agent' AND OBJECT_ID(N'dbo.CutClubMembershipBenefitUsageReversal',N'U') IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code='CASHER_BOOT' AND Status='active') THEN 1 ELSE 0 END AS Ready`);
 if(g.recordset[0]?.Ready!==1)fail('USAGE_NOT_RELEASED',403);
 const lock=await new sql.Request(tx).input('lock',sql.NVarChar(200),'CUTCLUB:MEMBERSHIP_DRAFT:'+s.tenantId.toLowerCase()).query<{Result:number}>(`DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000; SELECT @r AS Result;`);
 if(lock.recordset[0]?.Result===undefined||lock.recordset[0].Result<0)fail('USAGE_BUSY');
 const result=await fn(tx);await tx.commit();return result;
 }catch(e){await tx.rollback().catch(()=>{});throw e;}
}
const receiptQuery=`SELECT u.*,CASE WHEN r.SimulationReceiptID IS NULL THEN 0 ELSE 1 END AS Reversed FROM dbo.CutClubMembershipBenefitUsage u WITH(UPDLOCK,HOLDLOCK) LEFT JOIN dbo.CutClubMembershipBenefitUsageReversal r WITH(HOLDLOCK) ON r.TenantId=u.TenantId AND r.SimulationReceiptID=u.SimulationReceiptID WHERE u.TenantId=@tenant AND u.SimulationReceiptID=@receipt`;
/** Simulation only: one benefit line per synthetic receipt. Never called by a real sale. */
export async function recordSimulatedBenefitUsage(pool:sql.ConnectionPool,s:Scope,raw:unknown){
 const v=parseUsageInput(raw);if(!v)throw new BenefitUsageError('INVALID_USAGE',400);
 return run(pool,s,async tx=>{
 if(['PUBLICATION','BENEFIT_APPROVAL','TRIAL','APPLICATION_ISSUE'].some(k=>process.env['CUT_CLUB_STAGING_MEMBERSHIP_'+k+'_ENABLED']!=='true'))fail('USAGE_NOT_RELEASED',403);
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,s.tenantId);
 const key=()=>q().input('account',sql.UniqueIdentifier,v.accountId).input('code',sql.VarChar(40),v.programCode);
 const a=(await key().query<{LegacyClientID:number}>(`
 SELECT a.LegacyClientID FROM dbo.CutClubMemberAccount a WITH(UPDLOCK,HOLDLOCK) JOIN dbo.TblClient c WITH(HOLDLOCK) ON c.TenantId=a.TenantId AND c.ClientID=a.LegacyClientID
 CROSS APPLY(SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.Mobile)),' ',''),'-',''),'+',''),'(',''),')','') AS M) cleaned
 WHERE a.TenantId=@tenant AND a.AccountID=@account AND a.AccessStatus='ENABLED' AND a.LinkStatus='ACTIVE'
 AND a.PhoneNormalized=CASE WHEN LEN(cleaned.M)=11 AND cleaned.M LIKE '01[0125]%' THEN '2'+cleaned.M WHEN LEN(cleaned.M)=14 AND cleaned.M LIKE '00201[0125]%' THEN SUBSTRING(cleaned.M,3,12) ELSE cleaned.M END`)).recordset[0];
 if(!a?.LegacyClientID)throw new BenefitUsageError('ACCOUNT_NOT_ELIGIBLE',409);
 const rows=await key().query<Trial>(`
 WITH t AS(SELECT TOP(1) * FROM dbo.CutClubMembershipTrial WITH(HOLDLOCK) WHERE TenantId=@tenant AND AccountID=@account AND ProgramCode=@code ORDER BY Revision DESC),
 p AS(SELECT TOP(1) * FROM dbo.CutClubMembershipPublication WITH(HOLDLOCK) WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision DESC),
 b AS(SELECT TOP(1) * FROM dbo.CutClubMembershipBenefitApproval WITH(HOLDLOCK) WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision DESC)
 SELECT t.Revision,t.ProgramRevision,t.LegacyClientID,t.BranchID,t.ProofRevision,t.ExpiresAtUtc,d.Kind,d.MinimumVisits,d.Gleem,d.CampShizar,d.PartnerCode,
 (SELECT MAX(Revision) FROM dbo.CutClubMembershipProgramDraft WHERE TenantId=@tenant AND ProgramCode=@code) AS LatestProgram,
 p.Revision AS PublicationRevision,b.Revision AS ApprovalRevision,b.BenefitRevision,r.RulesJson,r.Reason
 FROM t JOIN dbo.CutClubMembershipProgramDraft d ON d.TenantId=t.TenantId AND d.ProgramCode=t.ProgramCode AND d.Revision=t.ProgramRevision
 JOIN dbo.CutClubMembershipApplicationFulfillment f ON f.TenantId=t.TenantId AND f.AccountID=t.AccountID AND f.ProgramCode=t.ProgramCode AND f.TrialRevision=t.Revision
 JOIN dbo.CutClubMembershipApplication x ON x.TenantId=f.TenantId AND x.ApplicationID=f.ApplicationID AND x.AccountID=t.AccountID AND x.LegacyClientID=t.LegacyClientID
 JOIN dbo.CutClubMembershipApplicationDecision decision ON decision.TenantId=x.TenantId AND decision.ApplicationID=x.ApplicationID AND decision.Decision='ACCEPTED_FOR_REVIEW'
 JOIN p ON p.Revision=x.PublicationRevision AND p.ProgramRevision=t.ProgramRevision AND p.Action='PUBLISH'
 JOIN b ON b.ProgramRevision=t.ProgramRevision AND b.PublicationRevision=p.Revision AND b.Action='APPROVE'
 JOIN dbo.CutClubMembershipBenefitDraft r ON r.TenantId=b.TenantId AND r.ProgramCode=b.ProgramCode AND r.ProgramRevision=b.ProgramRevision AND r.Revision=b.BenefitRevision
 WHERE x.ProgramCode=t.ProgramCode AND x.BranchID=t.BranchID`);
 const t=rows.recordset[0];
 if(rows.recordset.length!==1||!t||t.Revision!==v.trialRevision||t.ApprovalRevision!==v.approvalRevision||t.ProgramRevision!==t.LatestProgram||t.LegacyClientID!==a.LegacyClientID||t.BranchID!==v.branchId)throw new BenefitUsageError('MEMBERSHIP_OR_APPROVAL_NOT_CURRENT',409);
 const lr=await q().input('client',sql.Int,a.LegacyClientID).query<{TotalVisits:number|null}>(`SELECT TOP(2) l.TotalVisits FROM dbo.TblClientLoyalty l WITH(HOLDLOCK) JOIN dbo.TblClient c WITH(HOLDLOCK) ON c.ClientID=l.ClientID AND c.TenantId=@tenant WHERE l.ClientID=@client AND l.IsActive=1`);
 const n=lr.recordset[0]?.TotalVisits;const visits=lr.recordset.length===1&&typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?n:null;
 let proof:MemberFacts['proof']=null,proofRevision:number|null=null;
 if(t.Kind!=='GENERAL'){
 const e=(await key().input('kind',sql.VarChar(16),t.Kind).query<{Revision:number;Action:string;LegacyClientID:number;PartnerCode:string|null;ExpiresAtUtc:Date|null}>(`SELECT TOP(1) Revision,Action,LegacyClientID,PartnerCode,ExpiresAtUtc FROM dbo.CutClubMembershipProofEvent WITH(HOLDLOCK) WHERE TenantId=@tenant AND AccountID=@account AND Kind=@kind ORDER BY Revision DESC`)).recordset[0];
 if(e?.Action==='APPROVE'&&e.LegacyClientID===a.LegacyClientID){proofRevision=e.Revision;proof={kind:t.Kind,verified:true,partnerCode:e.PartnerCode,expiresAt:e.ExpiresAtUtc?.toISOString()??null};}
 }
 const now=(await new sql.Request(tx).query<{Now:Date}>('SELECT SYSUTCDATETIME() AS Now')).recordset[0].Now;
 const eligibility=evaluateMembershipEligibility({enabled:true,kind:t.Kind,minimumVisits:t.MinimumVisits,allowedBranchIds:[...(t.Gleem?[1]:[]),...(t.CampShizar?[3]:[])],partnerCode:t.PartnerCode},{accountStatus:'ACTIVE',completedVisits:visits,branchId:v.branchId,proof},now);
 if(!eligibility.eligible||t.ProofRevision!==proofRevision||t.ExpiresAtUtc<=now)fail('MEMBERSHIP_NOT_ELIGIBLE');
 const parsed=parseBenefitDraft({programCode:v.programCode,programRevision:t.ProgramRevision,expectedRevision:t.BenefitRevision-1,rules:JSON.parse(t.RulesJson),reason:t.Reason});
 const rule=parsed?.rules.find(r=>r.serviceId===v.serviceId);
 const svc=(await readBenefitCatalog(new sql.Request(tx),s.tenantId)).find(x=>x.id===v.serviceId);
 if(!rule||!svc)throw new BenefitUsageError('SERVICE_NOT_ELIGIBLE',409);
 const receipt=()=>q().input('receipt',sql.UniqueIdentifier,v.receiptId);
 const prior=(await receipt().query<Usage>(receiptQuery)).recordset[0];
 if(prior){
 if(prior.AccountID.toLowerCase()!==v.accountId||prior.ProgramCode!==v.programCode||prior.TrialRevision!==v.trialRevision||prior.ApprovalRevision!==v.approvalRevision||prior.LegacyClientID!==a.LegacyClientID||prior.ServiceID!==v.serviceId||prior.BranchID!==v.branchId||prior.Units!==v.units)fail('RECEIPT_CONFLICT');
 if(prior.Reversed===1)fail('RECEIPT_REVERSED');
 return {receiptId:v.receiptId,replayed:true,simulationOnly:true as const,originalMinor:Number(prior.OriginalMinor),discountMinor:Number(prior.DiscountMinor),finalMinor:Number(prior.FinalMinor),bonusCoins:prior.BonusCoins,units:prior.Units};
 }
 const used=(await key().input('trial',sql.Int,v.trialRevision).input('service',sql.Int,v.serviceId).query<{Used:number}>(`SELECT COALESCE(SUM(u.Units),0) AS Used FROM dbo.CutClubMembershipBenefitUsage u WITH(HOLDLOCK) WHERE u.TenantId=@tenant AND u.AccountID=@account AND u.ProgramCode=@code AND u.TrialRevision=@trial AND u.ServiceID=@service AND NOT EXISTS(SELECT 1 FROM dbo.CutClubMembershipBenefitUsageReversal r WITH(HOLDLOCK) WHERE r.TenantId=u.TenantId AND r.SimulationReceiptID=u.SimulationReceiptID)`)).recordset[0].Used;
 const quote=previewBenefit(rule,svc,v.branchId,v.units,used,0);
 if(!quote)throw new BenefitUsageError('LIMIT_OR_PRICE_INVALID',409);
 const w=await receipt().input('account',sql.UniqueIdentifier,v.accountId).input('code',sql.VarChar(40),v.programCode).input('trial',sql.Int,v.trialRevision).input('approval',sql.Int,v.approvalRevision).input('client',sql.Int,a.LegacyClientID).input('service',sql.Int,v.serviceId).input('branch',sql.Int,v.branchId).input('units',sql.Int,v.units).input('original',sql.BigInt,quote.originalMinor).input('discount',sql.BigInt,quote.discountMinor).input('final',sql.BigInt,quote.finalMinor).input('coins',sql.Int,quote.bonusCoins).input('staff',sql.Int,s.staffId).input('expiry',sql.DateTime2,t.ExpiresAtUtc).input('proofExpiry',sql.DateTime2,proof?.expiresAt?new Date(proof.expiresAt):null).query(`
 INSERT dbo.CutClubMembershipBenefitUsage(TenantId,SimulationReceiptID,AccountID,ProgramCode,TrialRevision,ApprovalRevision,LegacyClientID,ServiceID,BranchID,Units,OriginalMinor,DiscountMinor,FinalMinor,BonusCoins,StaffID)
 SELECT @tenant,@receipt,@account,@code,@trial,@approval,@client,@service,@branch,@units,@original,@discount,@final,@coins,@staff WHERE @expiry>SYSUTCDATETIME() AND (@proofExpiry IS NULL OR @proofExpiry>SYSUTCDATETIME())`);
 if(w.rowsAffected[0]!==1)fail('MEMBERSHIP_EXPIRED');
 return {receiptId:v.receiptId,replayed:false,simulationOnly:true as const,originalMinor:quote.originalMinor,discountMinor:quote.discountMinor,finalMinor:quote.finalMinor,bonusCoins:quote.bonusCoins,units:quote.units};
 });
}
/** Reversal is append-only and remains possible after membership expiry or approval revocation. */
export async function reverseSimulatedBenefitUsage(pool:sql.ConnectionPool,s:Scope,raw:unknown){
 const v=parseUsageReversal(raw);if(!v)throw new BenefitUsageError('INVALID_REVERSAL',400);
 return run(pool,s,async tx=>{
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,s.tenantId).input('receipt',sql.UniqueIdentifier,v.receiptId);
 const prior=(await q().query<Usage>(receiptQuery)).recordset[0];
 if(!prior)throw new BenefitUsageError('RECEIPT_NOT_FOUND',404);
 if(prior.Reversed===1)return {receiptId:v.receiptId,replayed:true,simulationOnly:true as const};
 const w=await q().input('staff',sql.Int,s.staffId).input('reason',sql.NVarChar(300),v.reason).query(`INSERT dbo.CutClubMembershipBenefitUsageReversal(TenantId,SimulationReceiptID,StaffID,Reason) VALUES(@tenant,@receipt,@staff,@reason)`);
 if(w.rowsAffected[0]!==1)fail('REVERSAL_FAILED',503);
 return {receiptId:v.receiptId,replayed:false,simulationOnly:true as const};
 });
}
