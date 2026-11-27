import 'server-only';
import sql from 'mssql';
import {pilotTenant,parseMembershipDraft,type DraftInput,type DraftRow} from './membershipDraft';
export class DraftError extends Error{constructor(public code:string,public status:number){super(code);}}
type Scope={tenantId:string;staffId:number};
const allowed=(scope:Scope)=>scope.tenantId.toLowerCase()===pilotTenant&&Number.isSafeInteger(scope.staffId)&&scope.staffId>0;
async function requireStage(request:sql.Request,scope:Scope){
 if(!allowed(scope)||process.env.CUT_CLUB_STAGING_MEMBERSHIP_DRAFT_ENABLED!=='true')throw new DraftError('DRAFT_NOT_RELEASED',403);
 const result=await request.input('tenant',sql.UniqueIdentifier,scope.tenantId).query<{Ready:number}>(`
  SELECT CASE WHEN DB_NAME()=N'last132_agent' AND SUSER_SNAME()=N'drvo_agent'
    AND OBJECT_ID(N'dbo.CutClubMembershipProgramDraft',N'U') IS NOT NULL
    AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code='CASHER_BOOT' AND Status='active')
    THEN 1 ELSE 0 END AS Ready`);
 if(result.recordset.length!==1||result.recordset[0].Ready!==1)throw new DraftError('DRAFT_SCHEMA_UNAVAILABLE',503);
}
type DbRow={ProgramCode:string;Revision:number;Title:string;Kind:DraftInput['kind'];MinimumVisits:number;Gleem:boolean;CampShizar:boolean;PartnerCode:string|null;Reason:string;CreatedAtUtc:Date};
const projection=(r:DbRow):DraftRow=>({code:r.ProgramCode,revision:r.Revision,title:r.Title,kind:r.Kind,minimumVisits:r.MinimumVisits,allowedBranchIds:[...(r.Gleem?[1]:[]),...(r.CampShizar?[3]:[])],partnerCode:r.PartnerCode,reason:r.Reason,createdAt:r.CreatedAtUtc.toISOString()});
export async function listMembershipDrafts(pool:sql.ConnectionPool,scope:Scope){
 await requireStage(pool.request(),scope);
 const result=await pool.request().input('tenant',sql.UniqueIdentifier,scope.tenantId).query<DbRow>(`
   WITH latest AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY ProgramCode ORDER BY Revision DESC) AS rn
     FROM dbo.CutClubMembershipProgramDraft WHERE TenantId=@tenant)
   SELECT TOP(101) ProgramCode,Revision,Title,Kind,MinimumVisits,Gleem,CampShizar,PartnerCode,Reason,CreatedAtUtc
   FROM latest WHERE rn=1 ORDER BY ProgramCode`);
 if(result.recordset.length>100)throw new DraftError('DRAFT_LIMIT',409);
 return result.recordset.map(projection);
}
export async function saveMembershipDraft(pool:sql.ConnectionPool,scope:Scope,raw:unknown):Promise<DraftRow>{
 const input=parseMembershipDraft(raw);
 if(!input)throw new DraftError('INVALID_DRAFT',400);
 await requireStage(pool.request(),scope);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
  await requireStage(new sql.Request(tx),scope);
  const lock=await new sql.Request(tx).input('lock',sql.NVarChar(200),'CUTCLUB:MEMBERSHIP_DRAFT:'+scope.tenantId.toLowerCase()).query<{Result:number}>(`
   DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000; SELECT @r AS Result;`);
  if(lock.recordset.length!==1||lock.recordset[0].Result<0)throw new DraftError('DRAFT_BUSY',409);
  const current=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,scope.tenantId).input('code',sql.VarChar(40),input.code).query<{Revision:number}>(`
   SELECT TOP(1) Revision FROM dbo.CutClubMembershipProgramDraft WITH(UPDLOCK,HOLDLOCK)
   WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision DESC`);
  if((current.recordset[0]?.Revision??0)!==input.expectedRevision)throw new DraftError('REVISION_CONFLICT',409);
  if(!current.recordset.length){
   const count=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,scope.tenantId).query<{C:number}>(`
    SELECT COUNT(DISTINCT ProgramCode) AS C FROM dbo.CutClubMembershipProgramDraft WHERE TenantId=@tenant`);
   if(count.recordset[0].C>=100)throw new DraftError('DRAFT_LIMIT',409);
  }
  const written=await new sql.Request(tx)
   .input('tenant',sql.UniqueIdentifier,scope.tenantId).input('code',sql.VarChar(40),input.code)
   .input('revision',sql.Int,input.expectedRevision+1).input('title',sql.NVarChar(100),input.title)
   .input('kind',sql.VarChar(16),input.kind).input('visits',sql.Int,input.minimumVisits)
   .input('gleem',sql.Bit,input.allowedBranchIds.includes(1)).input('camp',sql.Bit,input.allowedBranchIds.includes(3))
   .input('partner',sql.VarChar(40),input.partnerCode).input('staff',sql.Int,scope.staffId).input('reason',sql.NVarChar(300),input.reason)
   .query<DbRow>(`INSERT dbo.CutClubMembershipProgramDraft(TenantId,ProgramCode,Revision,Title,Kind,MinimumVisits,Gleem,CampShizar,PartnerCode,CreatedBy,Reason)
    OUTPUT INSERTED.ProgramCode,INSERTED.Revision,INSERTED.Title,INSERTED.Kind,INSERTED.MinimumVisits,INSERTED.Gleem,INSERTED.CampShizar,INSERTED.PartnerCode,INSERTED.Reason,INSERTED.CreatedAtUtc
    VALUES(@tenant,@code,@revision,@title,@kind,@visits,@gleem,@camp,@partner,@staff,@reason)`);
  if(written.recordset.length!==1)throw new DraftError('DRAFT_WRITE_FAILED',503);
  const row=projection(written.recordset[0]);await tx.commit();return row;
 }catch(e){await tx.rollback().catch(()=>{});throw e;}
}
