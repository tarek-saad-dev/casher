import 'server-only';
import sql from 'mssql';
import {pilotTenant} from './membershipDraft';
import {parsePublicationCommand,type PublishedProgram,type PublicationAdminRow} from './membershipPublication';
export class PublicationError extends Error{constructor(public code:string,public status:number){super(code);}}
type Scope={tenantId:string;staffId:number};
const allowed=(s:Scope)=>s.tenantId.toLowerCase()===pilotTenant&&Number.isSafeInteger(s.staffId)&&s.staffId>0;
async function gate(r:sql.Request,tenant:string){
 if(tenant.toLowerCase()!==pilotTenant||process.env.CUT_CLUB_STAGING_MEMBERSHIP_PUBLICATION_ENABLED!=='true')throw new PublicationError('PUBLICATION_NOT_RELEASED',403);
 const x=await r.input('tenant',sql.UniqueIdentifier,tenant).query<{Ready:number}>(`
 SELECT CASE WHEN DB_NAME()='last132_agent' AND SUSER_SNAME()='drvo_agent'
 AND OBJECT_ID(N'dbo.CutClubMembershipPublication',N'U') IS NOT NULL
 AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code='CASHER_BOOT' AND Status='active') THEN 1 ELSE 0 END AS Ready`);
 if(x.recordset[0]?.Ready!==1)throw new PublicationError('PUBLICATION_NOT_RELEASED',403);
}
type Row={ProgramCode:string;Title:string;Kind:PublishedProgram['kind'];ProgramRevision:number;PublicationRevision:number|null;PublishedProgramRevision:number|null;Action:string|null;MinimumVisits:number;Gleem:boolean;CampShizar:boolean;PartnerCode:string|null};
export async function listPublicationAdmin(pool:sql.ConnectionPool,s:Scope):Promise<PublicationAdminRow[]>{
 if(!allowed(s))throw new PublicationError('PUBLICATION_NOT_RELEASED',403);
 await gate(pool.request(),s.tenantId);
 const x=await pool.request().input('tenant',sql.UniqueIdentifier,s.tenantId).query<Row>(`
 WITH latest AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY ProgramCode ORDER BY Revision DESC) AS rn FROM dbo.CutClubMembershipProgramDraft WHERE TenantId=@tenant)
 SELECT TOP(101) d.ProgramCode,d.Title,d.Kind,d.Revision AS ProgramRevision,p.Revision AS PublicationRevision,p.ProgramRevision AS PublishedProgramRevision,p.Action
 FROM latest d OUTER APPLY(SELECT TOP(1) Revision,ProgramRevision,Action FROM dbo.CutClubMembershipPublication WHERE TenantId=d.TenantId AND ProgramCode=d.ProgramCode ORDER BY Revision DESC) p
 WHERE d.rn=1 ORDER BY d.ProgramCode`);
 if(x.recordset.length>100)throw new PublicationError('PUBLICATION_UNAVAILABLE',503);
 return x.recordset.map(r=>({code:r.ProgramCode,title:r.Title,kind:r.Kind,programRevision:r.ProgramRevision,publicationRevision:r.PublicationRevision??0,publishedProgramRevision:r.Action==='PUBLISH'?r.PublishedProgramRevision:null,
 status:!r.Action?'DRAFT':r.Action==='WITHDRAW'?'WITHDRAWN':r.PublishedProgramRevision===r.ProgramRevision?'PUBLISHED':'UPDATE_PENDING'}));
}
export async function publishMembership(pool:sql.ConnectionPool,s:Scope,raw:unknown){
 const v=parsePublicationCommand(raw);if(!v)throw new PublicationError('INVALID_PUBLICATION',400);
 if(!allowed(s))throw new PublicationError('PUBLICATION_NOT_RELEASED',403);
 await gate(pool.request(),s.tenantId);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
 await gate(new sql.Request(tx),s.tenantId);
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,s.tenantId).input('code',sql.VarChar(40),v.code);
 // Match draft writer's lock order; a concurrent draft cannot sneak into an approval.
 const lock=await new sql.Request(tx).input('lock',sql.NVarChar(200),'CUTCLUB:MEMBERSHIP_DRAFT:'+s.tenantId.toLowerCase()).query<{Result:number}>(`
 DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000; SELECT @r AS Result;`);
 if(lock.recordset[0]?.Result===undefined||lock.recordset[0].Result<0)throw new PublicationError('PUBLICATION_BUSY',409);
 const d=(await q().query<{Revision:number}>(`SELECT TOP(1) Revision FROM dbo.CutClubMembershipProgramDraft WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision DESC`)).recordset[0];
 if(!d)throw new PublicationError('PROGRAM_NOT_FOUND',404);
 const prev=(await q().query<{Revision:number;ProgramRevision:number;Action:string}>(`SELECT TOP(1) Revision,ProgramRevision,Action FROM dbo.CutClubMembershipPublication WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision DESC`)).recordset[0];
 if((prev?.Revision??0)!==v.expectedRevision)throw new PublicationError('PUBLICATION_REVISION_CONFLICT',409);
 if(v.action==='PUBLISH'&&d.Revision!==v.programRevision)throw new PublicationError('PROGRAM_REVISION_CONFLICT',409);
 if(v.action==='PUBLISH'&&prev?.Action==='PUBLISH'&&prev.ProgramRevision===v.programRevision)throw new PublicationError('ALREADY_PUBLISHED',409);
 if(v.action==='WITHDRAW'&&(!prev||prev.Action!=='PUBLISH'||prev.ProgramRevision!==v.programRevision))throw new PublicationError('NOT_PUBLISHED',409);
 const w=await q().input('revision',sql.Int,v.expectedRevision+1).input('program',sql.Int,v.programRevision).input('action',sql.VarChar(16),v.action).input('staff',sql.Int,s.staffId).input('reason',sql.NVarChar(300),v.reason).query(`
 INSERT dbo.CutClubMembershipPublication(TenantId,ProgramCode,Revision,ProgramRevision,Action,StaffID,Reason) VALUES(@tenant,@code,@revision,@program,@action,@staff,@reason)`);
 if(w.rowsAffected[0]!==1)throw new PublicationError('PUBLICATION_UNAVAILABLE',503);
 await tx.commit();return {revision:v.expectedRevision+1};
 }catch(e){await tx.rollback().catch(()=>{});throw e;}
}
/** Catalog contains only explicitly published immutable revisions, never draft notes or partner codes. */
export async function readPublishedMemberships(pool:sql.ConnectionPool):Promise<PublishedProgram[]>{
 await gate(pool.request(),pilotTenant);
 const x=await pool.request().input('tenant',sql.UniqueIdentifier,pilotTenant).query<Row>(`
 WITH latest AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY ProgramCode ORDER BY Revision DESC) AS rn FROM dbo.CutClubMembershipPublication WHERE TenantId=@tenant)
 SELECT TOP(101) d.ProgramCode,d.Title,d.Kind,d.Revision AS ProgramRevision,p.Revision AS PublicationRevision,d.MinimumVisits,d.Gleem,d.CampShizar,d.PartnerCode
 FROM latest p JOIN dbo.CutClubMembershipProgramDraft d ON d.TenantId=p.TenantId AND d.ProgramCode=p.ProgramCode AND d.Revision=p.ProgramRevision
 WHERE p.rn=1 AND p.Action='PUBLISH' ORDER BY d.ProgramCode`);
 if(x.recordset.length>100)throw new PublicationError('PUBLICATION_UNAVAILABLE',503);
 return x.recordset.map(r=>({code:r.ProgramCode,title:r.Title,kind:r.Kind,programRevision:r.ProgramRevision,publicationRevision:r.PublicationRevision!,minimumVisits:r.MinimumVisits,allowedBranchIds:[...(r.Gleem?[1]:[]),...(r.CampShizar?[3]:[])],requiresPartner:r.PartnerCode!==null}));
}
