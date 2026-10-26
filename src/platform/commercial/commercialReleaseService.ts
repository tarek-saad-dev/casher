import 'server-only';
import { randomUUID } from 'node:crypto';
import { getPool, sql } from '@/lib/db';
import {
  CommercialReleaseError, prepareCatalogReleaseCandidate,
  type CatalogReleaseCandidate, type ResearchSource,
} from './commercialReleasePolicy';

export type StoredCommercialCandidate=CatalogReleaseCandidate & {
  candidateId:string;createdAt:string;requestedByUserId:number;
};
const PROPOSAL_COLS=`p.ProposalId,p.IndustryCode,p.Version,p.PricingModel,p.CurrencyCode,
  p.AppPricesJson,p.BaseMonthlyMinor,p.ExtraBranchMonthlyMinor,
  p.IncludedBranches,p.AnnualMonthsCharged,p.Status,
  p.CreatedByUserId,p.ReviewedByUserId,p.ReviewedAt`;
function sourceFromRow(r:Record<string,unknown>):ResearchSource {
  return {
    proposalId:String(r.ProposalId),industryCode:String(r.IndustryCode),
    version:Number(r.Version),pricingModel:String(r.PricingModel),
    currencyCode:String(r.CurrencyCode),appPricesJson:String(r.AppPricesJson),
    baseMonthlyMinor:String(r.BaseMonthlyMinor),extraBranchMonthlyMinor:String(r.ExtraBranchMonthlyMinor),
    includedBranches:Number(r.IncludedBranches),annualMonthsCharged:Number(r.AnnualMonthsCharged),
    status:String(r.Status),createdByUserId:Number(r.CreatedByUserId),
    reviewedByUserId:r.ReviewedByUserId==null?null:Number(r.ReviewedByUserId),
    reviewedAt:r.ReviewedAt as Date|string|null,
  };
}
function shape(r:Record<string,unknown>):StoredCommercialCandidate {
  const current=prepareCatalogReleaseCandidate(sourceFromRow(r));
  if(current.sourceDigest!==String(r.SourceDigest)||current.sourceVersion!==Number(r.SourceVersion)||
     current.industry!==String(r.CandidateIndustry)||r.CandidateStatus!=='pending_policy')
    throw new CommercialReleaseError('RELEASE_SOURCE_CHANGED',
      'بصمة مصدر التسعير اتغيرت. ممنوع الاعتماد حتى المراجعة',409);
  return {...current,candidateId:String(r.CandidateId),
    createdAt:new Date(r.CandidateCreatedAt as Date|string).toISOString(),
    requestedByUserId:Number(r.RequestedByUserId)};
}
const JOIN=`SELECT TOP 50 c.CandidateId,c.SourceVersion,c.IndustryCode AS CandidateIndustry,
  c.SourceDigest,c.Status AS CandidateStatus,c.CreatedAt AS CandidateCreatedAt,
  c.RequestedByUserId,${PROPOSAL_COLS}
  FROM dbo.ModularCommercialReleaseCandidate c
  INNER JOIN dbo.ModularTariffResearchProposal p ON p.ProposalId=c.SourceProposalId`;
export async function listCommercialReleaseCandidates():Promise<StoredCommercialCandidate[]> {
  const pool=await getPool();
  const result=await pool.request().query(JOIN+' ORDER BY c.CreatedAt DESC,c.CandidateId DESC;');
  return (result.recordset as Record<string,unknown>[]).map(shape);
}

/** Read exactly one candidate and verify its immutable research-source digest. */
export async function getCommercialReleaseCandidate(candidateId:string):Promise<StoredCommercialCandidate> {
  const pool=await getPool();
  const result=await pool.request().input('id',sql.UniqueIdentifier,candidateId)
    .query(JOIN+' WHERE c.CandidateId=@id;');
  const row=result.recordset[0] as Record<string,unknown>|undefined;
  if(!row)throw new CommercialReleaseError('CANDIDATE_NOT_FOUND','ملف الإصدار غير موجود',404);
  return shape(row);
}

/** Only prepares a release dossier. Does not create an approved price catalog. */
export async function createCommercialReleaseCandidate(args:{
  sourceProposalId:string;actorUserId:number;
}):Promise<StoredCommercialCandidate> {
  if(!Number.isSafeInteger(args.actorUserId)||args.actorUserId<=0)
    throw new CommercialReleaseError('ACTOR_REQUIRED','لازم حساب مشغّل المنصة',403);
  const pool=await getPool(),tx=new sql.Transaction(pool);
  await tx.begin();
  try{
    const source=await new sql.Request(tx)
      .input('id',sql.UniqueIdentifier,args.sourceProposalId)
      .query(`SELECT ${PROPOSAL_COLS} FROM dbo.ModularTariffResearchProposal p WITH (UPDLOCK,HOLDLOCK)
        WHERE p.ProposalId=@id;`);
    if(!source.recordset[0])
      throw new CommercialReleaseError('SOURCE_NOT_FOUND','نسخة البحث غير موجودة',404);
    const prepared=prepareCatalogReleaseCandidate(sourceFromRow(source.recordset[0] as Record<string,unknown>));
    const existing=await new sql.Request(tx).input('id',sql.UniqueIdentifier,args.sourceProposalId)
      .query(`${JOIN} WHERE c.SourceProposalId=@id;`);
    if(existing.recordset[0]){
      const prior=shape(existing.recordset[0] as Record<string,unknown>);
      await tx.commit();return prior; // idempotent; no duplicate version/digest
    }
    const candidateId=randomUUID();
    await new sql.Request(tx).input('id',sql.UniqueIdentifier,candidateId)
      .input('sourceId',sql.UniqueIdentifier,args.sourceProposalId)
      .input('version',sql.Int,prepared.sourceVersion)
      .input('industry',sql.NVarChar(32),prepared.industry)
      .input('digest',sql.Char(64),prepared.sourceDigest)
      .input('actor',sql.Int,args.actorUserId).query(`
      INSERT INTO dbo.ModularCommercialReleaseCandidate
        (CandidateId,SourceProposalId,SourceVersion,IndustryCode,SourceDigest,Status,RequestedByUserId)
      VALUES (@id,@sourceId,@version,@industry,@digest,N'pending_policy',@actor);`);
    const saved=await new sql.Request(tx).input('id',sql.UniqueIdentifier,candidateId)
      .query(JOIN+' WHERE c.CandidateId=@id;');
    const result=shape(saved.recordset[0] as Record<string,unknown>);
    await tx.commit();return result;
  }catch(error){
    try{await tx.rollback();}catch{/* keep original error */}
    throw error;
  }
}
