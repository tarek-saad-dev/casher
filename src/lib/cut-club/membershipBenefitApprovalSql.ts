import 'server-only';
import sql from 'mssql';
import {pilotTenant} from './membershipDraft';
import {parseBenefitApproval,type BenefitApprovalRow} from './membershipBenefitApproval';
import {parseBenefitDraft} from './membershipBenefitDraft';
import {readBenefitCatalog} from './membershipBenefitDraftSql';
import {previewBenefit} from './membershipBenefitPreview';
export class BenefitApprovalError extends Error{constructor(public code:string,public status:number){super(code);}}
type Scope={tenantId:string;staffId:number};
type Row={ProgramCode:string;Revision:number;ProgramRevision:number;PublicationRevision:number;BenefitRevision:number;Action:'APPROVE'|'REVOKE';CatalogJson:string;CreatedAtUtc:Date;CurrentPublication:number|null;CurrentAction:string|null;LatestProgram:number|null};
async function gate(r:sql.Request,s:Scope){
 if(s.tenantId.toLowerCase()!==pilotTenant||!Number.isSafeInteger(s.staffId)||s.staffId<=0||process.env.CUT_CLUB_STAGING_MEMBERSHIP_BENEFIT_APPROVAL_ENABLED!=='true')throw new BenefitApprovalError('BENEFIT_APPROVAL_NOT_RELEASED',403);
 const x=await r.input('tenant',sql.UniqueIdentifier,s.tenantId).query<{Ready:number}>(`SELECT CASE WHEN DB_NAME()='last132_agent' AND SUSER_SNAME()='drvo_agent' AND OBJECT_ID(N'dbo.CutClubMembershipBenefitApproval',N'U') IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code='CASHER_BOOT' AND Status='active') THEN 1 ELSE 0 END AS Ready`);
 if(x.recordset[0]?.Ready!==1)throw new BenefitApprovalError('BENEFIT_APPROVAL_NOT_RELEASED',403);
}
export async function listBenefitApprovals(pool:sql.ConnectionPool,s:Scope):Promise<BenefitApprovalRow[]>{
 await gate(pool.request(),s);
 const x=await pool.request().input('tenant',sql.UniqueIdentifier,s.tenantId).query<Row>(`
 WITH latest AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY ProgramCode ORDER BY Revision DESC) AS rn FROM dbo.CutClubMembershipBenefitApproval WHERE TenantId=@tenant)
 SELECT TOP(101) a.*,p.Revision AS CurrentPublication,p.Action AS CurrentAction,(SELECT MAX(d.Revision) FROM dbo.CutClubMembershipProgramDraft d WHERE d.TenantId=a.TenantId AND d.ProgramCode=a.ProgramCode) AS LatestProgram
 FROM latest a OUTER APPLY(SELECT TOP(1) Revision,Action FROM dbo.CutClubMembershipPublication WHERE TenantId=a.TenantId AND ProgramCode=a.ProgramCode ORDER BY Revision DESC) p WHERE a.rn=1 ORDER BY a.ProgramCode`);
 if(x.recordset.length>100)throw new BenefitApprovalError('BENEFIT_APPROVAL_LIMIT',409);
 return x.recordset.map(r=>({programCode:r.ProgramCode,programRevision:r.ProgramRevision,publicationRevision:r.PublicationRevision,benefitRevision:r.BenefitRevision,revision:r.Revision,action:r.Action,status:r.Action==='REVOKE'?'REVOKED':r.CurrentAction!=='PUBLISH'||r.CurrentPublication!==r.PublicationRevision||r.LatestProgram!==r.ProgramRevision?'SUPERSEDED':'APPROVED_FOR_TEST',createdAt:r.CreatedAtUtc.toISOString()}));
}
export async function recordBenefitApproval(pool:sql.ConnectionPool,s:Scope,raw:unknown){
 const v=parseBenefitApproval(raw);if(!v)throw new BenefitApprovalError('INVALID_APPROVAL',400);
 await gate(pool.request(),s);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
 await gate(new sql.Request(tx),s);
 const lock=await new sql.Request(tx).input('lock',sql.NVarChar(200),'CUTCLUB:MEMBERSHIP_DRAFT:'+s.tenantId.toLowerCase()).query<{Result:number}>(`DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000; SELECT @r AS Result;`);
 if(lock.recordset[0]?.Result===undefined||lock.recordset[0].Result<0)throw new BenefitApprovalError('APPROVAL_BUSY',409);
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,s.tenantId).input('code',sql.VarChar(40),v.programCode);
 const prev=(await q().query<Row>(`SELECT TOP(1) * FROM dbo.CutClubMembershipBenefitApproval WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision DESC`)).recordset[0];
 if((prev?.Revision??0)!==v.expectedRevision)throw new BenefitApprovalError('APPROVAL_REVISION_CONFLICT',409);
 let snapshot='[]';
 if(v.action==='REVOKE'){
 if(!prev||prev.Action!=='APPROVE'||prev.ProgramRevision!==v.programRevision||prev.PublicationRevision!==v.publicationRevision||prev.BenefitRevision!==v.benefitRevision)throw new BenefitApprovalError('NOT_APPROVED',409);
 }else{
 if(process.env.CUT_CLUB_STAGING_MEMBERSHIP_PUBLICATION_ENABLED!=='true'||process.env.CUT_CLUB_STAGING_MEMBERSHIP_BENEFIT_DRAFT_ENABLED!=='true')throw new BenefitApprovalError('BENEFIT_APPROVAL_NOT_RELEASED',403);
 const program=(await q().query<{Revision:number;Gleem:boolean;CampShizar:boolean}>(`SELECT TOP(1) Revision,Gleem,CampShizar FROM dbo.CutClubMembershipProgramDraft WITH(HOLDLOCK) WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision DESC`)).recordset[0];
 const pub=(await q().query<{Revision:number;ProgramRevision:number;Action:string}>(`SELECT TOP(1) Revision,ProgramRevision,Action FROM dbo.CutClubMembershipPublication WITH(HOLDLOCK) WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision DESC`)).recordset[0];
 if(!program||program.Revision!==v.programRevision||!pub||pub.Action!=='PUBLISH'||pub.Revision!==v.publicationRevision||pub.ProgramRevision!==v.programRevision)throw new BenefitApprovalError('PROGRAM_NOT_CURRENT',409);
 const draft=(await q().input('program',sql.Int,v.programRevision).query<{Revision:number;RulesJson:string;Reason:string}>(`SELECT TOP(1) Revision,RulesJson,Reason FROM dbo.CutClubMembershipBenefitDraft WITH(HOLDLOCK) WHERE TenantId=@tenant AND ProgramCode=@code AND ProgramRevision=@program ORDER BY Revision DESC`)).recordset[0];
 if(!draft||draft.Revision!==v.benefitRevision)throw new BenefitApprovalError('BENEFIT_REVISION_CONFLICT',409);
 if(prev?.Action==='APPROVE'&&prev.ProgramRevision===v.programRevision&&prev.PublicationRevision===v.publicationRevision&&prev.BenefitRevision===v.benefitRevision)throw new BenefitApprovalError('ALREADY_APPROVED',409);
 const parsed=parseBenefitDraft({programCode:v.programCode,programRevision:v.programRevision,expectedRevision:draft.Revision-1,rules:JSON.parse(draft.RulesJson),reason:draft.Reason});
 if(!parsed||!parsed.rules.length)throw new BenefitApprovalError('EMPTY_OR_INVALID_RULES',409);
 const catalog=await readBenefitCatalog(new sql.Request(tx),s.tenantId);
 const rows=parsed.rules.map(rule=>{
 const svc=catalog.find(x=>x.id===rule.serviceId);
 if(!svc||rule.branchIds.some(b=>b===1?!program.Gleem:!program.CampShizar)||rule.branchIds.some(b=>!previewBenefit(rule,svc,b,1,0,0)))throw new BenefitApprovalError('BENEFIT_CATALOG_OR_PRICE_INVALID',409);
 return {serviceId:svc.id,name:svc.name,priceMinor:svc.priceMinor};
 });
 snapshot=JSON.stringify(rows);
 }
 const w=await q().input('revision',sql.Int,v.expectedRevision+1).input('program',sql.Int,v.programRevision).input('publication',sql.Int,v.publicationRevision).input('benefit',sql.Int,v.benefitRevision).input('action',sql.VarChar(16),v.action).input('catalog',sql.NVarChar(sql.MAX),snapshot).input('staff',sql.Int,s.staffId).input('reason',sql.NVarChar(300),v.reason).query(`
 INSERT dbo.CutClubMembershipBenefitApproval(TenantId,ProgramCode,Revision,ProgramRevision,PublicationRevision,BenefitRevision,Action,CatalogJson,StaffID,Reason) VALUES(@tenant,@code,@revision,@program,@publication,@benefit,@action,@catalog,@staff,@reason)`);
 if(w.rowsAffected[0]!==1)throw new BenefitApprovalError('APPROVAL_FAILED',503);
 await tx.commit();return {revision:v.expectedRevision+1};
 }catch(e){await tx.rollback().catch(()=>{});throw e;}
}
