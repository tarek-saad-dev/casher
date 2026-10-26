import 'server-only';
import {randomUUID} from 'node:crypto';
import {getPool,sql} from '@/lib/db';
import {assertNotBootstrapTenant} from '@/platform/commercial/bootstrapGuard';
import {acquireTenantApplock,TENANT_COMMERCIAL_LOCK_PARTS} from '@/platform/tenant/tenantApplock';
import {prepareCatalogReleaseCandidate,type ResearchSource} from './commercialReleasePolicy';
import {simulateModularResearchInquiry,type ResearchInquirySnapshot,type ReviewedTariffSnapshot} from './modularQuoteLab';
import {
  makeInternalQuoteSnapshot,verifyInternalQuoteSnapshot,InternalQuoteSnapshotError,
  type InternalQuoteSnapshotPayload,
} from './internalQuoteSnapshotPolicy';

export type PersistedInternalQuoteSnapshot=InternalQuoteSnapshotPayload & {
  createdByUserId:number;
};
const COLS=`SnapshotId,TenantId,RequestId,CandidateId,ResearchVersion,DraftRevision,
  SourceDigest,QuoteDigest,ResearchQuoteJson,Status,CreatedByUserId,CreatedAt,ExpiresAt`;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertId(id:string):void{
  if(typeof id!=='string'||!UUID.test(id))
    throw new InternalQuoteSnapshotError('INVALID_ID','معرف غير صالح',400);
}
function shaped(row:Record<string,unknown>,nowUtc:string):PersistedInternalQuoteSnapshot {
  let researchQuote:InternalQuoteSnapshotPayload['researchQuote'];
  try{researchQuote=JSON.parse(String(row.ResearchQuoteJson)) as typeof researchQuote;}
  catch{throw new InternalQuoteSnapshotError('SNAPSHOT_INVALID','بيانات المحاكاة المحفوظة غير سليمة');}
  const payload:InternalQuoteSnapshotPayload={
    snapshotId:String(row.SnapshotId).toLowerCase(),
    tenantId:String(row.TenantId).toLowerCase(),requestId:String(row.RequestId).toLowerCase(),
    candidateId:String(row.CandidateId).toLowerCase(),
    researchVersion:Number(row.ResearchVersion),draftRevision:Number(row.DraftRevision),
    sourceDigest:String(row.SourceDigest),quoteDigest:String(row.QuoteDigest),
    researchQuote,createdAt:new Date(row.CreatedAt as Date|string).toISOString(),
    expiresAt:new Date(row.ExpiresAt as Date|string).toISOString(),
    status:String(row.Status) as 'internal_only',availability:'internal_current',
    canIssueCustomerQuote:false,canAcceptOrder:false,canCheckout:false,
    canActivate:false,paid:false,orderCreated:false,
  };
  return {...verifyInternalQuoteSnapshot(payload,nowUtc),createdByUserId:Number(row.CreatedByUserId)};
}
/** Internal operator list, no customer visibility or finance mutations. */
export async function listInternalQuoteSnapshots():Promise<PersistedInternalQuoteSnapshot[]>{
  const pool=await getPool();
  const r=await pool.request().query(`SELECT TOP 50 ${COLS}
    FROM dbo.ModularInternalQuoteSnapshot ORDER BY CreatedAt DESC,SnapshotId DESC;`);
  const now=new Date().toISOString();
  return (r.recordset as Record<string,unknown>[]).map(row=>shaped(row,now));
}

/** Strictly internal: only two saved IDs can be supplied by operator client. */
export async function createInternalQuoteSnapshot(args:{
  requestId:string;candidateId:string;actorUserId:number;
}):Promise<PersistedInternalQuoteSnapshot>{
  assertId(args.requestId);assertId(args.candidateId);
  if(!Number.isSafeInteger(args.actorUserId)||args.actorUserId<=0)
    throw new InternalQuoteSnapshotError('ACTOR_REQUIRED','حساب المشغّل غير صالح',403);
  const pool=await getPool(),tx=new sql.Transaction(pool);
  await tx.begin();
  try{
    // Initial owner resolution is read-only; the authoritative row is re-read after tenant locking.
    const owner=await new sql.Request(tx).input('requestId',sql.UniqueIdentifier,args.requestId)
      .query(`SELECT TenantId FROM dbo.TenantModularQuoteRequest WHERE RequestId=@requestId;`);
    const tenantId=owner.recordset[0]?.TenantId?String(owner.recordset[0].TenantId):null;
    if(!tenantId)throw new InternalQuoteSnapshotError('INQUIRY_NOT_FOUND','الطلب مش موجود',404);
    await assertNotBootstrapTenant(tx,tenantId,'createInternalQuoteSnapshot');
    await acquireTenantApplock(tx,tenantId,TENANT_COMMERCIAL_LOCK_PARTS);

    const inquiryRow=await new sql.Request(tx).input('id',sql.UniqueIdentifier,args.requestId)
      .input('tenantId',sql.UniqueIdentifier,tenantId)
      .query(`SELECT r.RequestId,r.TenantId,t.Code AS TenantCode,r.DraftRevision,
        r.Status,r.IndustryCode,r.AppsJson,r.BranchCount,r.BillingCycle
        FROM dbo.TenantModularQuoteRequest r WITH (UPDLOCK,HOLDLOCK)
        INNER JOIN dbo.Tenant t ON t.TenantId=r.TenantId AND t.Status=N'active'
        INNER JOIN dbo.TenantIndustryPack pack
          ON pack.TenantId=r.TenantId AND pack.PackCode=r.IndustryCode
        WHERE r.RequestId=@id AND r.TenantId=@tenantId;`);
    const row=inquiryRow.recordset[0] as Record<string,unknown>|undefined;
    if(!row)throw new InternalQuoteSnapshotError('INQUIRY_UNAVAILABLE',
      'المنشأة أو الطلب غير متاح',409);
    const inquiry:ResearchInquirySnapshot={
      requestId:String(row.RequestId),tenantId:String(row.TenantId),
      tenantCode:String(row.TenantCode),status:String(row.Status) as ResearchInquirySnapshot['status'],
      industry:String(row.IndustryCode),draftRevision:Number(row.DraftRevision),
      apps:JSON.parse(String(row.AppsJson)) as string[],branches:Number(row.BranchCount),
      billingCycle:String(row.BillingCycle) as ResearchInquirySnapshot['billingCycle'],
    };
    if(inquiry.status!=='awaiting_pricing')
      throw new InternalQuoteSnapshotError('INQUIRY_CLOSED','الطلب مقفول بالفعل',409);

    const sourceRow=await new sql.Request(tx).input('id',sql.UniqueIdentifier,args.candidateId)
      .query(`SELECT c.CandidateId,c.SourceDigest,c.SourceVersion,c.Status AS CandidateStatus,
       c.IndustryCode AS CandidateIndustry,p.ProposalId,p.IndustryCode,p.Version,
       p.PricingModel,p.CurrencyCode,p.AppPricesJson,p.BaseMonthlyMinor,p.ExtraBranchMonthlyMinor,
       p.IncludedBranches,p.AnnualMonthsCharged,p.Status,p.CreatedByUserId,p.ReviewedByUserId,
       p.ReviewedAt,p.ReviewNote
       FROM dbo.ModularCommercialReleaseCandidate c WITH (UPDLOCK,HOLDLOCK)
       INNER JOIN dbo.ModularTariffResearchProposal p ON p.ProposalId=c.SourceProposalId
       WHERE c.CandidateId=@id;`);
    const src=sourceRow.recordset[0] as Record<string,unknown>|undefined;
    if(!src)throw new InternalQuoteSnapshotError('CANDIDATE_NOT_FOUND','ملف بحث الأسعار مش موجود',404);
    if(src.CandidateStatus!=='pending_policy')
      throw new InternalQuoteSnapshotError('CANDIDATE_NOT_INTERNAL','الكتالوج مش في حالة بحث داخلي');
    const researchSource:ResearchSource={
      proposalId:String(src.ProposalId),industryCode:String(src.IndustryCode),
      version:Number(src.Version),pricingModel:String(src.PricingModel),
      currencyCode:String(src.CurrencyCode),appPricesJson:String(src.AppPricesJson),
      baseMonthlyMinor:String(src.BaseMonthlyMinor),extraBranchMonthlyMinor:String(src.ExtraBranchMonthlyMinor),
      includedBranches:Number(src.IncludedBranches),annualMonthsCharged:Number(src.AnnualMonthsCharged),
      status:String(src.Status),createdByUserId:Number(src.CreatedByUserId),
      reviewedByUserId:src.ReviewedByUserId==null?null:Number(src.ReviewedByUserId),
      reviewedAt:src.ReviewedAt as Date|string|null,
    };
    const candidate=prepareCatalogReleaseCandidate(researchSource);
    if(candidate.sourceDigest!==String(src.SourceDigest)||
       candidate.sourceVersion!==Number(src.SourceVersion)||
       candidate.industry!==String(src.CandidateIndustry))
      throw new InternalQuoteSnapshotError('SOURCE_CHANGED','بيانات الكتالوج البحثي اتغيرت');

    const prior=await new sql.Request(tx).input('tenantId',sql.UniqueIdentifier,tenantId)
      .input('requestId',sql.UniqueIdentifier,args.requestId)
      .input('candidateId',sql.UniqueIdentifier,args.candidateId)
      .query(`SELECT ${COLS} FROM dbo.ModularInternalQuoteSnapshot WITH (UPDLOCK,HOLDLOCK)
        WHERE TenantId=@tenantId AND RequestId=@requestId AND CandidateId=@candidateId;`);
    if(prior.recordset[0]){
      const result=shaped(prior.recordset[0] as Record<string,unknown>,new Date().toISOString());
      if(result.sourceDigest!==candidate.sourceDigest||
         result.researchVersion!==candidate.sourceVersion||
         result.draftRevision!==inquiry.draftRevision)
        throw new InternalQuoteSnapshotError('SNAPSHOT_SOURCE_CHANGED','بصمة النسخة المحفوظة مختلفة',409);
      await tx.commit();return result;
    }
    const proposal:ReviewedTariffSnapshot={
      proposalId:String(src.ProposalId),industry:String(src.IndustryCode),
      version:Number(src.Version),status:String(src.Status) as ReviewedTariffSnapshot['status'],
      createdByUserId:Number(src.CreatedByUserId),
      reviewedByUserId:src.ReviewedByUserId==null?null:Number(src.ReviewedByUserId),
      reviewedAt:src.ReviewedAt?new Date(src.ReviewedAt as Date|string).toISOString():null,
      reviewNote:src.ReviewNote==null?null:String(src.ReviewNote),
      pricingModel:String(src.PricingModel) as ReviewedTariffSnapshot['pricingModel'],
      appPricesMinor:JSON.parse(String(src.AppPricesJson)) as Record<string,number>,
      baseMonthlyMinor:Number(src.BaseMonthlyMinor),extraBranchMonthlyMinor:Number(src.ExtraBranchMonthlyMinor),
      includedBranches:Number(src.IncludedBranches),annualMonthsCharged:Number(src.AnnualMonthsCharged),
      currency:String(src.CurrencyCode) as 'EGP',
    };
    const simulation=simulateModularResearchInquiry(inquiry,proposal);
    // Whole-second creation prevents DATETIME2(3) round-tripping surprises.
    const now=new Date();
    now.setUTCMilliseconds(0);
    const payload=makeInternalQuoteSnapshot({
      snapshotId:randomUUID(),source:{
        requestId:inquiry.requestId,tenantId:inquiry.tenantId,candidateId:args.candidateId,
        sourceDigest:candidate.sourceDigest,researchVersion:candidate.sourceVersion,
        draftRevision:inquiry.draftRevision,simulation,
      },createdAt:now.toISOString(),
    });
    const inserted=await new sql.Request(tx).input('snapshotId',sql.UniqueIdentifier,payload.snapshotId)
      .input('tenantId',sql.UniqueIdentifier,payload.tenantId)
      .input('requestId',sql.UniqueIdentifier,payload.requestId)
      .input('candidateId',sql.UniqueIdentifier,payload.candidateId)
      .input('researchVersion',sql.Int,payload.researchVersion)
      .input('draftRevision',sql.Int,payload.draftRevision)
      .input('sourceDigest',sql.Char(64),payload.sourceDigest)
      .input('quoteDigest',sql.Char(64),payload.quoteDigest)
      .input('research',sql.NVarChar(sql.MAX),JSON.stringify(payload.researchQuote))
      .input('actor',sql.Int,args.actorUserId)
      .input('created',sql.DateTime2,new Date(payload.createdAt))
      .input('expires',sql.DateTime2,new Date(payload.expiresAt))
      .query(`INSERT INTO dbo.ModularInternalQuoteSnapshot
        (SnapshotId,TenantId,RequestId,CandidateId,ResearchVersion,DraftRevision,
         SourceDigest,QuoteDigest,ResearchQuoteJson,Status,CreatedByUserId,CreatedAt,ExpiresAt)
        VALUES (@snapshotId,@tenantId,@requestId,@candidateId,@researchVersion,@draftRevision,
         @sourceDigest,@quoteDigest,@research,N'internal_only',@actor,@created,@expires);
        SELECT ${COLS} FROM dbo.ModularInternalQuoteSnapshot WHERE SnapshotId=@snapshotId;`);
    const result=shaped(inserted.recordset[0] as Record<string,unknown>,new Date().toISOString());
    await tx.commit();return result;
  }catch(error){try{await tx.rollback();}catch{/* Preserve original error */}throw error;}
}
