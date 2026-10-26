import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  ModularQuoteLabError, simulateModularResearchInquiry,
  type ResearchInquirySnapshot, type ReviewedTariffSnapshot, type QuoteLabSimulation,
} from './modularQuoteLab';

/**
 * Operator-only, read-only simulation. Source identifiers are read from SQL,
 * not trusted amounts or tenant identities supplied by the browser.
 */
export async function simulateStoredModularInquiry(args:{
  requestId:string;proposalId:string;
}):Promise<QuoteLabSimulation> {
  const pool=await getPool();
  const [i,p]=await Promise.all([
    pool.request().input('requestId',sql.UniqueIdentifier,args.requestId).query(`
      SELECT r.RequestId,r.TenantId,t.Code AS TenantCode,r.Status,
        r.IndustryCode,r.DraftRevision,r.AppsJson,r.BranchCount,r.BillingCycle
      FROM dbo.TenantModularQuoteRequest r
      INNER JOIN dbo.Tenant t ON t.TenantId=r.TenantId AND t.Status=N'active'
      INNER JOIN dbo.TenantIndustryPack pack
        ON pack.TenantId=r.TenantId AND pack.PackCode=r.IndustryCode
      WHERE r.RequestId=@requestId;`),
    pool.request().input('proposalId',sql.UniqueIdentifier,args.proposalId).query(`
      SELECT ProposalId,IndustryCode,Version,PricingModel,CurrencyCode,AppPricesJson,
        BaseMonthlyMinor,ExtraBranchMonthlyMinor,IncludedBranches,AnnualMonthsCharged,
        Status,CreatedByUserId,ReviewedByUserId,ReviewedAt,ReviewNote
      FROM dbo.ModularTariffResearchProposal
      WHERE ProposalId=@proposalId;`),
  ]);
  const inquiry=i.recordset[0] as Record<string,unknown>|undefined;
  const research=p.recordset[0] as Record<string,unknown>|undefined;
  if(!inquiry)throw new ModularQuoteLabError('INQUIRY_NOT_FOUND',
    'الطلب غير موجود أو نشاطه لم يعد نشطًا',404);
  if(!research)throw new ModularQuoteLabError('RESEARCH_NOT_FOUND',
    'نسخة البحث غير موجودة',404);

  const inquirySnapshot:ResearchInquirySnapshot={
    requestId:String(inquiry.RequestId),tenantId:String(inquiry.TenantId),
    tenantCode:String(inquiry.TenantCode),
    status:String(inquiry.Status) as ResearchInquirySnapshot['status'],
    industry:String(inquiry.IndustryCode),draftRevision:Number(inquiry.DraftRevision),
    apps:JSON.parse(String(inquiry.AppsJson)) as string[],
    branches:Number(inquiry.BranchCount),
    billingCycle:String(inquiry.BillingCycle) as ResearchInquirySnapshot['billingCycle'],
  };
  const proposalSnapshot:ReviewedTariffSnapshot={
    proposalId:String(research.ProposalId),industry:String(research.IndustryCode),
    version:Number(research.Version),status:String(research.Status) as ReviewedTariffSnapshot['status'],
    createdByUserId:Number(research.CreatedByUserId),
    reviewedByUserId:research.ReviewedByUserId==null?null:Number(research.ReviewedByUserId),
    reviewedAt:research.ReviewedAt?new Date(research.ReviewedAt as Date|string).toISOString():null,
    reviewNote:research.ReviewNote==null?null:String(research.ReviewNote),
    pricingModel:String(research.PricingModel) as ReviewedTariffSnapshot['pricingModel'],
    appPricesMinor:JSON.parse(String(research.AppPricesJson)) as Record<string,number>,
    baseMonthlyMinor:Number(research.BaseMonthlyMinor),
    extraBranchMonthlyMinor:Number(research.ExtraBranchMonthlyMinor),
    includedBranches:Number(research.IncludedBranches),
    annualMonthsCharged:Number(research.AnnualMonthsCharged),
    currency:String(research.CurrencyCode) as 'EGP',
  };
  return simulateModularResearchInquiry(inquirySnapshot,proposalSnapshot);
}
