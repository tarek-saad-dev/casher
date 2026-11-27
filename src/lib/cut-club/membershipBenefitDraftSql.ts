import 'server-only';
import sql from 'mssql';
import {pilotTenant} from './membershipDraft';
import {evaluateServiceEligibility,type PublicBookingServiceRow} from '@/lib/booking/publicBookingServicePolicy';
import type {BenefitCatalogService} from './membershipBenefitPreview';
import {parseBenefitDraft,type BenefitDraft} from './membershipBenefitDraft';
export class BenefitDraftError extends Error{constructor(public code:string,public status:number){super(code);}}
type Scope={tenantId:string;staffId:number};
type Row={ProgramCode:string;ProgramRevision:number;Revision:number;RulesJson:string;Reason:string;CreatedAtUtc:Date};
async function gate(r:sql.Request,s:Scope){
 if(s.tenantId.toLowerCase()!==pilotTenant||!Number.isSafeInteger(s.staffId)||s.staffId<=0||process.env.CUT_CLUB_STAGING_MEMBERSHIP_BENEFIT_DRAFT_ENABLED!=='true')throw new BenefitDraftError('BENEFITS_NOT_RELEASED',403);
 const x=await r.input('tenant',sql.UniqueIdentifier,s.tenantId).query<{Ready:number}>(`SELECT CASE WHEN DB_NAME()='last132_agent' AND SUSER_SNAME()='drvo_agent' AND OBJECT_ID(N'dbo.CutClubMembershipBenefitDraft',N'U') IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code='CASHER_BOOT' AND Status='active') THEN 1 ELSE 0 END AS Ready`);
 if(x.recordset[0]?.Ready!==1)throw new BenefitDraftError('BENEFITS_NOT_RELEASED',403);
}
const project=(r:Row):BenefitDraft=>{
 const parsed=parseBenefitDraft({programCode:r.ProgramCode,programRevision:r.ProgramRevision,expectedRevision:r.Revision-1,rules:JSON.parse(r.RulesJson),reason:r.Reason});
 if(!parsed)throw new BenefitDraftError('INVALID_SAVED_DRAFT',503);
 return {programCode:parsed.programCode,programRevision:parsed.programRevision,rules:parsed.rules,reason:parsed.reason,revision:r.Revision,createdAt:r.CreatedAtUtc.toISOString()};
};
export async function listBenefitDrafts(pool:sql.ConnectionPool,s:Scope){
 await gate(pool.request(),s);
 const r=await pool.request().input('tenant',sql.UniqueIdentifier,s.tenantId).query<Row>(`
 WITH latest AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY ProgramCode,ProgramRevision ORDER BY Revision DESC) AS rn FROM dbo.CutClubMembershipBenefitDraft WHERE TenantId=@tenant)
 SELECT TOP(101) b.ProgramCode,b.ProgramRevision,b.Revision,b.RulesJson,b.Reason,b.CreatedAtUtc FROM latest b
 WHERE b.rn=1 AND b.ProgramRevision=(SELECT MAX(d.Revision) FROM dbo.CutClubMembershipProgramDraft d WHERE d.TenantId=b.TenantId AND d.ProgramCode=b.ProgramCode) ORDER BY b.ProgramCode`);
 if(r.recordset.length>100)throw new BenefitDraftError('BENEFITS_LIMIT',409);
 return r.recordset.map(project);
}
export async function saveBenefitDraft(pool:sql.ConnectionPool,s:Scope,raw:unknown){
 const v=parseBenefitDraft(raw);if(!v)throw new BenefitDraftError('INVALID_BENEFIT_DRAFT',400);
 await gate(pool.request(),s);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
 await gate(new sql.Request(tx),s);
 const lock=await new sql.Request(tx).input('lock',sql.NVarChar(200),'CUTCLUB:MEMBERSHIP_DRAFT:'+s.tenantId.toLowerCase()).query<{Result:number}>(`DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000; SELECT @r AS Result;`);
 if(lock.recordset[0]?.Result===undefined||lock.recordset[0].Result<0)throw new BenefitDraftError('BENEFIT_BUSY',409);
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,s.tenantId).input('code',sql.VarChar(40),v.programCode);
 const d=(await q().query<{Revision:number;Gleem:boolean;CampShizar:boolean}>(`SELECT TOP(1) Revision,Gleem,CampShizar FROM dbo.CutClubMembershipProgramDraft WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND ProgramCode=@code ORDER BY Revision DESC`)).recordset[0];
 if(!d||d.Revision!==v.programRevision)throw new BenefitDraftError('PROGRAM_REVISION_CONFLICT',409);
 if(v.rules.some(r=>r.branchIds.some(b=>b===1?!d.Gleem:!d.CampShizar)))throw new BenefitDraftError('BENEFIT_BRANCH_OUTSIDE_PROGRAM',409);
 const key=()=>q().input('programRev',sql.Int,v.programRevision);
 const prev=(await key().query<{Revision:number}>(`SELECT TOP(1) Revision FROM dbo.CutClubMembershipBenefitDraft WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND ProgramCode=@code AND ProgramRevision=@programRev ORDER BY Revision DESC`)).recordset[0];
 if((prev?.Revision??0)!==v.expectedRevision)throw new BenefitDraftError('BENEFIT_REVISION_CONFLICT',409);
 // IDs are draft proposals; real catalog/branch/service and prices must be validated before any publication.
 const w=await key().input('revision',sql.Int,v.expectedRevision+1).input('rules',sql.NVarChar(sql.MAX),JSON.stringify(v.rules)).input('staff',sql.Int,s.staffId).input('reason',sql.NVarChar(300),v.reason).query<Row>(`
 INSERT dbo.CutClubMembershipBenefitDraft(TenantId,ProgramCode,ProgramRevision,Revision,RulesJson,StaffID,Reason)
 OUTPUT INSERTED.ProgramCode,INSERTED.ProgramRevision,INSERTED.Revision,INSERTED.RulesJson,INSERTED.Reason,INSERTED.CreatedAtUtc
 VALUES(@tenant,@code,@programRev,@revision,@rules,@staff,@reason)`);
 if(w.recordset.length!==1)throw new BenefitDraftError('BENEFIT_SAVE_FAILED',503);
 const result=project(w.recordset[0]);await tx.commit();return result;
 }catch(e){await tx.rollback().catch(()=>{});throw e;}
}

/** Strict tenant catalog; global SPrice1, NOT branch price or POS entitlement. No schema ensures/writes. */
export async function listBenefitCatalog(pool:sql.ConnectionPool,s:Scope):Promise<BenefitCatalogService[]>{
 await gate(pool.request(),s);
 return readBenefitCatalog(pool.request(),s.tenantId);
}
/** Caller must hold a verified staging scope. Transactional request allows serializable approval reads. */
export async function readBenefitCatalog(request:sql.Request,tenantId:string):Promise<BenefitCatalogService[]>{
 const r=await request.input('tenant',sql.UniqueIdentifier,tenantId).query<PublicBookingServiceRow>(`
 SELECT TOP(1001) p.ProID,p.ProName,p.ProNameAr,p.SPrice1,p.DurationMinutes,p.isDeleted,p.ProType,p.CatID,c.CatName,c.CatType
 FROM dbo.TblPro p JOIN dbo.TblCat c ON c.TenantId=p.TenantId AND c.CatID=p.CatID
 WHERE p.TenantId=@tenant AND ISNULL(p.isDeleted,0)=0 AND LOWER(LTRIM(RTRIM(c.CatType)))='serv' ORDER BY p.ProID`);
 if(r.recordset.length>1000)throw new BenefitDraftError('CATALOG_LIMIT',503);
 const ids=new Set<number>();const items:BenefitCatalogService[]=[];
 for(const row of r.recordset){
 const e=evaluateServiceEligibility(row);const name=row.ProNameAr?.trim()||row.ProName?.trim();const price=e.price===null?0:Math.round(e.price*100);
 if(!e.eligible||!name||!Number.isSafeInteger(price)||price<1||price>100000000||Math.abs((e.price??0)*100-price)>0.000001||!Number.isSafeInteger(row.ProID)||row.ProID<1)continue;
 if(ids.has(row.ProID))throw new BenefitDraftError('CATALOG_DUPLICATE',503);
 ids.add(row.ProID);items.push({id:row.ProID,name,priceMinor:price});
 }
 return items;
}
