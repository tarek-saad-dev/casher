import 'server-only';
import sql from 'mssql';
import {digestToken} from './memberOtp';
import {pilotTenant} from './membershipDraft';
import {evaluateMembershipEligibility,type MembershipKind,type MemberFacts} from './membershipPolicy';
export class MembershipReadError extends Error{constructor(public code:string,public status:number){super(code);}}
type Row={Title:string;Kind:MembershipKind;ProgramCode:string;ProgramRevision:number;LatestRevision:number;TrialClientID:number;BranchID:number;TrialProofRevision:number|null;ExpiresAtUtc:Date;MinimumVisits:number;Gleem:boolean;CampShizar:boolean;PartnerCode:string|null;ProofRevision:number|null;ProofAction:string|null;ProofClientID:number|null;ProofPartner:string|null;ProofExpiry:Date|null};
export async function readMembershipTrials(pool:sql.ConnectionPool,token:unknown){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new MembershipReadError('SESSION_REQUIRED',401);
 if(process.env.CUT_CLUB_STAGING_MEMBERSHIP_MEMBER_READ_ENABLED!=='true')throw new MembershipReadError('MEMBERSHIPS_NOT_RELEASED',403);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
 const g=await new sql.Request(tx).query<{Ready:number}>(`SELECT CASE WHEN DB_NAME()='last132_agent' AND SUSER_SNAME()='drvo_agent'
 AND OBJECT_ID(N'dbo.CutClubMembershipTrial',N'U') IS NOT NULL AND COL_LENGTH(N'dbo.CutClubMemberAccount',N'AccessStatus') IS NOT NULL
 THEN 1 ELSE 0 END AS Ready`);
 if(g.recordset[0]?.Ready!==1)throw new MembershipReadError('MEMBERSHIPS_NOT_RELEASED',403);
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,pilotTenant);
 const a=await q().input('digest',sql.Char(64),digestToken(token)).query<{AccountID:string;LegacyClientID:number|null;AccessStatus:string;LinkStatus:string;PhoneMatches:number}>(`
 SELECT a.AccountID,a.LegacyClientID,a.AccessStatus,a.LinkStatus,CASE WHEN EXISTS(
 SELECT 1 FROM dbo.TblClient c WITH(HOLDLOCK)
 CROSS APPLY(SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.Mobile)),' ',''),'-',''),'+',''),'(',''),')','') AS M) cleaned
 WHERE c.TenantId=a.TenantId AND c.ClientID=a.LegacyClientID AND a.PhoneNormalized=CASE WHEN LEN(cleaned.M)=11 AND cleaned.M LIKE '01[0125]%' THEN '2'+cleaned.M WHEN LEN(cleaned.M)=14 AND cleaned.M LIKE '00201[0125]%' THEN SUBSTRING(cleaned.M,3,12) ELSE cleaned.M END)
 THEN 1 ELSE 0 END AS PhoneMatches
 FROM dbo.CutClubCustomerSession s WITH(HOLDLOCK) JOIN dbo.CutClubMemberAccount a WITH(HOLDLOCK) ON a.TenantId=s.TenantId AND a.AccountID=s.AccountID
 JOIN dbo.Tenant t WITH(HOLDLOCK) ON t.TenantId=a.TenantId AND t.Code='CASHER_BOOT' AND t.Status='active'
 WHERE s.TenantId=@tenant AND s.TokenDigest=@digest AND s.RevokedAtUtc IS NULL AND s.ExpiresAtUtc>SYSUTCDATETIME()`);
 if(a.recordset.length!==1)throw new MembershipReadError('SESSION_REQUIRED',401);
 const member=a.recordset[0];
 const accountStatus=member.AccessStatus==='SUSPENDED'?'SUSPENDED':member.AccessStatus!=='ENABLED'?'REVIEW_REQUIRED':member.LinkStatus==='UNLINKED'?'UNLINKED':member.LinkStatus==='ACTIVE'&&member.PhoneMatches===1&&member.LegacyClientID?'ACTIVE':'REVIEW_REQUIRED';
 const base={ok:true as const,trialOnly:true as const,enrollmentEnabled:false as const,accountStatus};
 if(accountStatus!=='ACTIVE'){await tx.commit();return {...base,items:[]};}
 const lr=await q().input('client',sql.Int,member.LegacyClientID).query<{TotalVisits:number|null}>(`SELECT TOP(2) l.TotalVisits FROM dbo.TblClientLoyalty l WITH(HOLDLOCK) JOIN dbo.TblClient c WITH(HOLDLOCK) ON c.ClientID=l.ClientID AND c.TenantId=@tenant WHERE l.ClientID=@client AND l.IsActive=1`);
 const n=lr.recordset[0]?.TotalVisits;
 const visits=lr.recordset.length===1&&typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?n:null;
 const result=await q().input('account',sql.UniqueIdentifier,member.AccountID).input('client',sql.Int,member.LegacyClientID).query<Row>(`
 WITH latest AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY ProgramCode ORDER BY Revision DESC) AS rn FROM dbo.CutClubMembershipTrial WITH(HOLDLOCK) WHERE TenantId=@tenant AND AccountID=@account)
 SELECT TOP(101) d.Title,d.Kind,x.ProgramCode,x.ProgramRevision,latestDraft.Revision AS LatestRevision,x.LegacyClientID AS TrialClientID,x.BranchID,x.ProofRevision AS TrialProofRevision,x.ExpiresAtUtc,
 d.MinimumVisits,d.Gleem,d.CampShizar,d.PartnerCode,e.Revision AS ProofRevision,e.Action AS ProofAction,e.LegacyClientID AS ProofClientID,e.PartnerCode AS ProofPartner,e.ExpiresAtUtc AS ProofExpiry
 FROM latest x JOIN dbo.CutClubMembershipProgramDraft d WITH(HOLDLOCK) ON d.TenantId=x.TenantId AND d.ProgramCode=x.ProgramCode AND d.Revision=x.ProgramRevision
 CROSS APPLY(SELECT TOP(1) Revision FROM dbo.CutClubMembershipProgramDraft WITH(HOLDLOCK) WHERE TenantId=x.TenantId AND ProgramCode=x.ProgramCode ORDER BY Revision DESC) latestDraft
 OUTER APPLY(SELECT TOP(1) Revision,Action,LegacyClientID,PartnerCode,ExpiresAtUtc FROM dbo.CutClubMembershipProofEvent WITH(HOLDLOCK) WHERE TenantId=x.TenantId AND AccountID=x.AccountID AND Kind=d.Kind ORDER BY Revision DESC) e
 WHERE x.rn=1 AND x.LegacyClientID=@client ORDER BY x.ProgramCode`);
 if(result.recordset.length>100)throw new MembershipReadError('MEMBERSHIPS_UNAVAILABLE',503);
 const now=(await new sql.Request(tx).query<{Now:Date}>('SELECT SYSUTCDATETIME() AS Now')).recordset[0].Now;
 const items=result.recordset.map(r=>{
 const proof:MemberFacts['proof']=r.Kind!=='GENERAL'&&r.ProofAction==='APPROVE'&&r.ProofClientID===member.LegacyClientID?{kind:r.Kind,verified:true,partnerCode:r.ProofPartner,expiresAt:r.ProofExpiry?.toISOString()??null}:null;
 const eligible=evaluateMembershipEligibility({kind:r.Kind,enabled:true,minimumVisits:r.MinimumVisits,allowedBranchIds:[...(r.Gleem?[1]:[]),...(r.CampShizar?[3]:[])],partnerCode:r.PartnerCode},{accountStatus:'ACTIVE',completedVisits:visits,branchId:r.BranchID,proof},now).eligible;
 const status=r.ExpiresAtUtc<=now?'EXPIRED':!eligible||r.ProgramRevision!==r.LatestRevision||r.TrialProofRevision!==(proof?r.ProofRevision:null)?'INVALIDATED':'CURRENT';
 return {code:r.ProgramCode,title:r.Title,kind:r.Kind,status,expiresAt:r.ExpiresAtUtc.toISOString(),branchId:r.BranchID,benefitsEnabled:false as const};
 });
 // Recheck expiry before releasing private data; locks serialize revocation with this read.
 const live=await q().input('digest',sql.Char(64),digestToken(token)).query<{Live:number}>(`SELECT COUNT(*) AS Live FROM dbo.CutClubCustomerSession WHERE TenantId=@tenant AND TokenDigest=@digest AND RevokedAtUtc IS NULL AND ExpiresAtUtc>SYSUTCDATETIME()`);
 if(live.recordset[0]?.Live!==1)throw new MembershipReadError('SESSION_REQUIRED',401);
 await tx.commit();return {...base,items};
 }catch(e){await tx.rollback().catch(()=>{});throw e;}
}
