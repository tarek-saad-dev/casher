import 'server-only';
import { randomUUID } from 'node:crypto';
import { getPool, sql } from '@/lib/db';
import {
  ResearchTariffError,validateIndependentReview,validateTariffResearchInput,
  type TariffResearchInput,type ResearchReviewAction,
} from './tariffResearchPolicy';

export type TariffResearchProposal={
  proposalId:string;industry:'salon';version:number;
  pricingModel:'per_app'|'base_plus_apps';currency:'EGP';
  appPricesMinor:Record<string,number>;baseMonthlyMinor:number;
  extraBranchMonthlyMinor:number;includedBranches:number;annualMonthsCharged:number;
  status:'submitted'|'reviewed_research'|'changes_requested';
  createdByUserId:number;createdAt:string;
  reviewedByUserId:number|null;reviewedAt:string|null;reviewNote:string|null;
  scope:'internal_research';approvedForSale:false;canIssueQuote:false;
  canCheckout:false;canActivate:false;
};
const COLS=`ProposalId,IndustryCode,Version,PricingModel,CurrencyCode,AppPricesJson,
  BaseMonthlyMinor,ExtraBranchMonthlyMinor,IncludedBranches,AnnualMonthsCharged,
  Status,CreatedByUserId,CreatedAt,ReviewedByUserId,ReviewedAt,ReviewNote`;
function iso(value:unknown):string|null {
  return value==null?null:new Date(value as Date|string).toISOString();
}
function shaped(row:Record<string,unknown>):TariffResearchProposal {
  return {
    proposalId:String(row.ProposalId),industry:'salon',version:Number(row.Version),
    pricingModel:String(row.PricingModel) as TariffResearchProposal['pricingModel'],currency:'EGP',
    appPricesMinor:JSON.parse(String(row.AppPricesJson)) as Record<string,number>,
    baseMonthlyMinor:Number(row.BaseMonthlyMinor),extraBranchMonthlyMinor:Number(row.ExtraBranchMonthlyMinor),
    includedBranches:Number(row.IncludedBranches),annualMonthsCharged:Number(row.AnnualMonthsCharged),
    status:String(row.Status) as TariffResearchProposal['status'],
    createdByUserId:Number(row.CreatedByUserId),createdAt:iso(row.CreatedAt)!,
    reviewedByUserId:row.ReviewedByUserId==null?null:Number(row.ReviewedByUserId),
    reviewedAt:iso(row.ReviewedAt),reviewNote:row.ReviewNote==null?null:String(row.ReviewNote),
    scope:'internal_research',approvedForSale:false,canIssueQuote:false,
    canCheckout:false,canActivate:false,
  };
}
export async function listTariffResearchProposals():Promise<TariffResearchProposal[]> {
  const pool=await getPool();
  const r=await pool.request().query(`SELECT TOP 50 ${COLS}
    FROM dbo.ModularTariffResearchProposal
    ORDER BY CreatedAt DESC,Version DESC;`);
  return (r.recordset as Record<string,unknown>[]).map(shaped);
}

/** Versioned, write-once INTERNAL tariff candidate — no catalog sync or customer quotes. */
export async function createTariffResearchProposal(args:{
  actorUserId:number;candidate:TariffResearchInput;
}):Promise<TariffResearchProposal> {
  if(!Number.isSafeInteger(args.actorUserId)||args.actorUserId<=0)
    throw new ResearchTariffError('ACTOR_REQUIRED','تعذر معرفة صاحب المقترح',403);
  const candidate=validateTariffResearchInput(args.candidate);
  const pool=await getPool(),tx=new sql.Transaction(pool);
  await tx.begin();
  try{
    const lock=await new sql.Request(tx)
      .input('resource',sql.NVarChar(255),'drvo:tariff-research:'+candidate.industry)
      .input('timeout',sql.Int,10000).query(`
        DECLARE @ret INT;
        EXEC @ret=sp_getapplock @Resource=@resource,@LockMode='Exclusive',
          @LockOwner='Transaction',@LockTimeout=@timeout;
        SELECT @ret AS lockResult;`);
    if(Number(lock.recordset[0]?.lockResult)<0||!Number.isInteger(Number(lock.recordset[0]?.lockResult)))
      throw new ResearchTariffError('RESEARCH_LOCK_BUSY','في تعديل أسعار بحثية آخر جاري، جرّب تاني',409);
    const next=await new sql.Request(tx).input('industry',sql.NVarChar(32),candidate.industry)
      .query(`SELECT ISNULL(MAX(Version),0) AS lastVersion
        FROM dbo.ModularTariffResearchProposal WITH (UPDLOCK,HOLDLOCK)
        WHERE IndustryCode=@industry;`);
    const previous=Number(next.recordset[0]?.lastVersion);
    if(!Number.isSafeInteger(previous)||previous>=2147483647)
      throw new ResearchTariffError('VERSION_EXHAUSTED','تعذر إنشاء إصدار تسعير جديد',409);
    const version=previous+1,proposalId=randomUUID();
    const result=await new sql.Request(tx)
      .input('id',sql.UniqueIdentifier,proposalId)
      .input('industry',sql.NVarChar(32),candidate.industry)
      .input('version',sql.Int,version)
      .input('model',sql.NVarChar(20),candidate.pricingModel)
      .input('prices',sql.NVarChar(sql.MAX),JSON.stringify(candidate.appPricesMinor))
      .input('base',sql.BigInt,candidate.baseMonthlyMinor)
      .input('branch',sql.BigInt,candidate.extraBranchMonthlyMinor)
      .input('included',sql.Int,candidate.includedBranches)
      .input('annual',sql.Int,candidate.annualMonthsCharged)
      .input('actor',sql.Int,args.actorUserId)
      .query(`INSERT INTO dbo.ModularTariffResearchProposal
        (ProposalId,IndustryCode,Version,PricingModel,CurrencyCode,AppPricesJson,
         BaseMonthlyMinor,ExtraBranchMonthlyMinor,IncludedBranches,AnnualMonthsCharged,
         Status,CreatedByUserId)
        VALUES (@id,@industry,@version,@model,'EGP',@prices,
          @base,@branch,@included,@annual,N'submitted',@actor);
        SELECT ${COLS} FROM dbo.ModularTariffResearchProposal WHERE ProposalId=@id;`);
    const response=shaped(result.recordset[0] as Record<string,unknown>);
    await tx.commit();return response;
  }catch(error){
    try{await tx.rollback();}catch{/* original error wins */}throw error;
  }
}

/** Two distinct platform actors; review does NOT constitute price approval for sale. */
export async function reviewTariffResearchProposal(args:{
  actorUserId:number;proposalId:string;action:ResearchReviewAction;note:string;
}):Promise<TariffResearchProposal> {
  const pool=await getPool(),tx=new sql.Transaction(pool);
  await tx.begin();
  try{
    const lookup=await new sql.Request(tx).input('id',sql.UniqueIdentifier,args.proposalId)
      .query(`SELECT ${COLS} FROM dbo.ModularTariffResearchProposal WITH (UPDLOCK,HOLDLOCK)
        WHERE ProposalId=@id;`);
    const row=lookup.recordset[0] as Record<string,unknown>|undefined;
    if(!row)throw new ResearchTariffError('NOT_FOUND','المقترح غير موجود',404);
    const proposal=shaped(row);
    if(proposal.createdByUserId===args.actorUserId)
      throw new ResearchTariffError('SEPARATION_REQUIRED','لازم شخص تاني يراجع المقترح',403);
    if(proposal.status!=='submitted'){
      if(proposal.status===args.action&&proposal.reviewNote===args.note.trim()&&
         proposal.reviewedByUserId===args.actorUserId){
        await tx.commit();return proposal; // identical replay; no second review
      }
      throw new ResearchTariffError('ALREADY_REVIEWED','المقترح اتراجع بالفعل، حدث القائمة',409);
    }
    const note=validateIndependentReview({
      creatorId:proposal.createdByUserId,reviewerId:args.actorUserId,
      status:proposal.status,action:args.action,note:args.note,
    });
    const reviewed=await new sql.Request(tx).input('id',sql.UniqueIdentifier,args.proposalId)
      .input('actor',sql.Int,args.actorUserId).input('status',sql.NVarChar(24),args.action)
      .input('note',sql.NVarChar(500),note).query(`
        UPDATE dbo.ModularTariffResearchProposal
        SET Status=@status,ReviewedByUserId=@actor,ReviewedAt=SYSUTCDATETIME(),ReviewNote=@note
        WHERE ProposalId=@id AND Status=N'submitted' AND CreatedByUserId<>@actor;
        SELECT @@ROWCOUNT AS changed;`);
    if(Number(reviewed.recordset[0]?.changed)!==1)
      throw new ResearchTariffError('REVIEW_CONFLICT','المراجعة اتغيرت أثناء الحفظ',409);
    const snapshot=await new sql.Request(tx).input('id',sql.UniqueIdentifier,args.proposalId).query(
      `SELECT ${COLS} FROM dbo.ModularTariffResearchProposal WHERE ProposalId=@id;`);
    const result=shaped(snapshot.recordset[0] as Record<string,unknown>);
    await tx.commit();return result;
  }catch(error){
    try{await tx.rollback();}catch{/* original error wins */}throw error;
  }
}
