import 'server-only';
import sql from 'mssql';
import {pilotTenant} from './membershipDraft';
import {digestToken} from './memberOtp';
import {parseApplication,parseApplicationDecision,type ApplicationRow,type ApplicationStatus} from './membershipApplication';
export class ApplicationError extends Error{constructor(public code:string,public status:number){super(code);}}
type Staff={tenantId:string;staffId:number};
type Owner={AccountID:string;LegacyClientID:number};
type DbRow={ApplicationID:string;ProgramCode:string;Title:string;PublicationRevision:number;BranchID:1|3;CreatedAtUtc:Date;Status:ApplicationStatus;AccountID:string};
const enabled=()=>process.env.CUT_CLUB_STAGING_MEMBERSHIP_APPLICATION_ENABLED==='true';
async function gate(r:sql.Request){
 if(!enabled())throw new ApplicationError('APPLICATIONS_NOT_RELEASED',403);
 const x=await r.input('tenant',sql.UniqueIdentifier,pilotTenant).query<{Ready:number}>(`SELECT CASE WHEN DB_NAME()='last132_agent' AND SUSER_SNAME()='drvo_agent' AND OBJECT_ID(N'dbo.CutClubMembershipApplicationDecision',N'U') IS NOT NULL AND OBJECT_ID(N'dbo.CutClubMembershipApplicationFulfillment',N'U') IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code='CASHER_BOOT' AND Status='active') THEN 1 ELSE 0 END AS Ready`);
 if(x.recordset[0]?.Ready!==1)throw new ApplicationError('APPLICATIONS_NOT_RELEASED',403);
}
const q=(tx:sql.Transaction)=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,pilotTenant);
async function transaction<T>(pool:sql.ConnectionPool,run:(tx:sql.Transaction)=>Promise<T>):Promise<T>{
 if(!enabled())throw new ApplicationError('APPLICATIONS_NOT_RELEASED',403);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{await gate(new sql.Request(tx));const value=await run(tx);await tx.commit();return value;}catch(e){await tx.rollback().catch(()=>{});throw e;}
}
const matchingPhone=`EXISTS(SELECT 1 FROM dbo.TblClient c WITH(HOLDLOCK)
 CROSS APPLY(SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.Mobile)),' ',''),'-',''),'+',''),'(',''),')','') AS M) cleaned
 WHERE c.TenantId=a.TenantId AND c.ClientID=a.LegacyClientID AND a.PhoneNormalized=CASE WHEN LEN(cleaned.M)=11 AND cleaned.M LIKE '01[0125]%' THEN '2'+cleaned.M WHEN LEN(cleaned.M)=14 AND cleaned.M LIKE '00201[0125]%' THEN SUBSTRING(cleaned.M,3,12) ELSE cleaned.M END)`;
async function owner(tx:sql.Transaction,token:unknown):Promise<Owner>{
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new ApplicationError('SESSION_REQUIRED',401);
 const x=await q(tx).input('digest',sql.Char(64),digestToken(token)).query<Owner>(`
 SELECT a.AccountID,a.LegacyClientID FROM dbo.CutClubCustomerSession s WITH(HOLDLOCK) JOIN dbo.CutClubMemberAccount a WITH(UPDLOCK,HOLDLOCK) ON a.TenantId=s.TenantId AND a.AccountID=s.AccountID
 WHERE s.TenantId=@tenant AND s.TokenDigest=@digest AND s.RevokedAtUtc IS NULL AND s.ExpiresAtUtc>SYSUTCDATETIME() AND a.AccessStatus='ENABLED' AND a.LinkStatus='ACTIVE' AND ${matchingPhone}`);
 if(x.recordset.length!==1||!x.recordset[0].LegacyClientID)throw new ApplicationError('ACCOUNT_OR_SESSION_REQUIRED',403);
 return x.recordset[0];
}
async function publicationLock(tx:sql.Transaction){
 const r=await new sql.Request(tx).input('lock',sql.NVarChar(200),'CUTCLUB:MEMBERSHIP_DRAFT:'+pilotTenant).query<{Result:number}>(`DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000; SELECT @r AS Result;`);
 if(r.recordset[0]?.Result===undefined||r.recordset[0].Result<0)throw new ApplicationError('APPLICATION_BUSY',409);
}
const projection=(r:DbRow):ApplicationRow=>({id:r.ApplicationID.toLowerCase(),code:r.ProgramCode,title:r.Title,publicationRevision:r.PublicationRevision,branchId:r.BranchID,status:r.Status,createdAt:r.CreatedAtUtc.toISOString()});
const selection=`SELECT TOP(101) x.ApplicationID,x.AccountID,x.ProgramCode,d.Title,x.PublicationRevision,x.BranchID,x.CreatedAtUtc,
 CASE WHEN decision.Decision='REJECTED' THEN 'REJECTED' WHEN latest.Revision<>x.PublicationRevision OR latest.Action<>'PUBLISH' THEN 'PROGRAM_CHANGED' WHEN fulfillment.ApplicationID IS NOT NULL THEN 'TRIAL_ISSUED' ELSE COALESCE(decision.Decision,'PENDING') END AS Status
 FROM dbo.CutClubMembershipApplication x WITH(HOLDLOCK)
 JOIN dbo.CutClubMembershipPublication p ON p.TenantId=x.TenantId AND p.ProgramCode=x.ProgramCode AND p.Revision=x.PublicationRevision
 JOIN dbo.CutClubMembershipProgramDraft d ON d.TenantId=p.TenantId AND d.ProgramCode=p.ProgramCode AND d.Revision=p.ProgramRevision
 CROSS APPLY(SELECT TOP(1) Revision,Action FROM dbo.CutClubMembershipPublication WITH(HOLDLOCK) WHERE TenantId=x.TenantId AND ProgramCode=x.ProgramCode ORDER BY Revision DESC) latest
 LEFT JOIN dbo.CutClubMembershipApplicationDecision decision WITH(HOLDLOCK) ON decision.TenantId=x.TenantId AND decision.ApplicationID=x.ApplicationID
 LEFT JOIN dbo.CutClubMembershipApplicationFulfillment fulfillment WITH(HOLDLOCK) ON fulfillment.TenantId=x.TenantId AND fulfillment.ApplicationID=x.ApplicationID WHERE x.TenantId=@tenant`;
export async function listMemberApplications(pool:sql.ConnectionPool,token:unknown){
 return transaction(pool,async tx=>{
 const a=await owner(tx,token);
 const r=await q(tx).input('account',sql.UniqueIdentifier,a.AccountID).input('client',sql.Int,a.LegacyClientID).query<DbRow>(selection+' AND x.AccountID=@account AND x.LegacyClientID=@client ORDER BY x.CreatedAtUtc DESC,x.ApplicationID');
 await owner(tx,token);
 if(r.recordset.length>100)throw new ApplicationError('APPLICATION_LIMIT',409);
 return r.recordset.map(projection);
 });
}
export async function submitMembershipApplication(pool:sql.ConnectionPool,token:unknown,raw:unknown){
 const v=parseApplication(raw);if(!v)throw new ApplicationError('INVALID_APPLICATION',400);
 return transaction(pool,async tx=>{
 if(process.env.CUT_CLUB_STAGING_MEMBERSHIP_PUBLICATION_ENABLED!=='true')throw new ApplicationError('PUBLICATION_NOT_RELEASED',403);
 await publicationLock(tx);const a=await owner(tx,token);
 const p=await q(tx).input('code',sql.VarChar(40),v.code).query<{Revision:number;Action:string;Gleem:boolean;CampShizar:boolean}>(`
 SELECT TOP(1) p.Revision,p.Action,d.Gleem,d.CampShizar FROM dbo.CutClubMembershipPublication p WITH(HOLDLOCK)
 JOIN dbo.CutClubMembershipProgramDraft d WITH(HOLDLOCK) ON d.TenantId=p.TenantId AND d.ProgramCode=p.ProgramCode AND d.Revision=p.ProgramRevision WHERE p.TenantId=@tenant AND p.ProgramCode=@code ORDER BY p.Revision DESC`);
 const latest=p.recordset[0];
 if(!latest||latest.Action!=='PUBLISH'||latest.Revision!==v.publicationRevision)throw new ApplicationError('PROGRAM_CHANGED',409);
 if(!(v.branchId===1?latest.Gleem:latest.CampShizar))throw new ApplicationError('BRANCH_NOT_ELIGIBLE',409);
 const key=()=>q(tx).input('account',sql.UniqueIdentifier,a.AccountID).input('code',sql.VarChar(40),v.code).input('publication',sql.Int,v.publicationRevision);
 const existing=await key().query<{ApplicationID:string;LegacyClientID:number;BranchID:number}>(`SELECT ApplicationID,LegacyClientID,BranchID FROM dbo.CutClubMembershipApplication WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND AccountID=@account AND ProgramCode=@code AND PublicationRevision=@publication`);
 const prev=existing.recordset[0];
 if(prev){if(prev.LegacyClientID!==a.LegacyClientID||prev.BranchID!==v.branchId)throw new ApplicationError('APPLICATION_ALREADY_EXISTS',409);await owner(tx,token);return {id:prev.ApplicationID.toLowerCase(),replayed:true};}
 const count=await q(tx).input('account',sql.UniqueIdentifier,a.AccountID).query<{C:number}>(`SELECT COUNT(*) AS C FROM dbo.CutClubMembershipApplication WHERE TenantId=@tenant AND AccountID=@account`);
 if(count.recordset[0].C>=100)throw new ApplicationError('APPLICATION_LIMIT',409);
 const w=await key().input('client',sql.Int,a.LegacyClientID).input('branch',sql.Int,v.branchId).query<{ApplicationID:string}>(`INSERT dbo.CutClubMembershipApplication(TenantId,AccountID,LegacyClientID,ProgramCode,PublicationRevision,BranchID) OUTPUT INSERTED.ApplicationID VALUES(@tenant,@account,@client,@code,@publication,@branch)`);
 await owner(tx,token);return {id:w.recordset[0].ApplicationID.toLowerCase(),replayed:false};
 });
}
function staff(s:Staff){if(s.tenantId.toLowerCase()!==pilotTenant||!Number.isSafeInteger(s.staffId)||s.staffId<=0)throw new ApplicationError('FORBIDDEN',403);}
export async function listAdminApplications(pool:sql.ConnectionPool,s:Staff){
 staff(s);return transaction(pool,async tx=>{
 const r=await q(tx).query<DbRow>(selection+' ORDER BY x.CreatedAtUtc DESC,x.ApplicationID');
 return {items:r.recordset.slice(0,100).map(x=>({...projection(x),accountId:x.AccountID.toLowerCase()})),hasMore:r.recordset.length>100};
 });
}
export async function decideMembershipApplication(pool:sql.ConnectionPool,s:Staff,raw:unknown){
 staff(s);const v=parseApplicationDecision(raw);if(!v)throw new ApplicationError('INVALID_DECISION',400);
 return transaction(pool,async tx=>{
 await publicationLock(tx);
 const r=await q(tx).input('id',sql.UniqueIdentifier,v.id).query<DbRow>(selection+' AND x.ApplicationID=@id');
 const x=r.recordset[0];if(!x)throw new ApplicationError('APPLICATION_NOT_FOUND',404);
 if(x.Status!=='PENDING')throw new ApplicationError('APPLICATION_NOT_PENDING',409);
 if(v.decision==='ACCEPTED_FOR_REVIEW'){
 if(process.env.CUT_CLUB_STAGING_MEMBERSHIP_PUBLICATION_ENABLED!=='true')throw new ApplicationError('PUBLICATION_NOT_RELEASED',403);
 const a=await q(tx).input('id',sql.UniqueIdentifier,v.id).query<{Eligible:number}>(`
 SELECT COUNT(*) AS Eligible FROM dbo.CutClubMembershipApplication x JOIN dbo.CutClubMemberAccount a WITH(UPDLOCK,HOLDLOCK) ON a.TenantId=x.TenantId AND a.AccountID=x.AccountID AND a.LegacyClientID=x.LegacyClientID WHERE x.TenantId=@tenant AND x.ApplicationID=@id AND a.AccessStatus='ENABLED' AND a.LinkStatus='ACTIVE' AND ${matchingPhone}`);
 if(a.recordset[0]?.Eligible!==1)throw new ApplicationError('ACCOUNT_INELIGIBLE',409);
 }
 await q(tx).input('id',sql.UniqueIdentifier,v.id).input('decision',sql.VarChar(24),v.decision).input('staff',sql.Int,s.staffId).input('reason',sql.NVarChar(300),v.reason).query(`INSERT dbo.CutClubMembershipApplicationDecision(TenantId,ApplicationID,Decision,StaffID,Reason) VALUES(@tenant,@id,@decision,@staff,@reason)`);
 return {decision:v.decision};
 });
}
