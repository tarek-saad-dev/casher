import { createHash } from 'node:crypto';
import { validateTariffResearchInput, ResearchTariffError } from './tariffResearchPolicy';

/**
 * Commercial policy checklist is a release gate, NOT a publication API.
 * This module deliberately has no 'approved' state or prices from research.
 */
export const COMMERCIAL_RELEASE_BLOCKERS = [
  'COMMERCIAL_PRICING_NOT_APPROVED',
  'BILLING_UNIT_NOT_APPROVED',
  'BRANCH_QUOTAS_NOT_APPROVED',
  'ANNUAL_TERMS_NOT_APPROVED',
  'TAXES_AND_INVOICE_RULES_NOT_APPROVED',
  'REFUND_PRORATION_NOT_APPROVED',
  'TRIAL_FREE_AND_USAGE_LIMITS_NOT_APPROVED',
  'LEGAL_CONTRACT_NOT_APPROVED',
  'GATEWAY_SETTLEMENT_NOT_VERIFIED',
  'STAGING_END_TO_END_NOT_VERIFIED',
] as const;
export type CommercialBlocker = (typeof COMMERCIAL_RELEASE_BLOCKERS)[number];

export class CommercialReleaseError extends Error {
  constructor(readonly code:string, message:string, readonly status=409) {
    super(message);this.name='CommercialReleaseError';
  }
}
export type ResearchSource = {
  proposalId:string;industryCode:string;version:number;
  pricingModel:string;currencyCode:string;appPricesJson:string;
  baseMonthlyMinor:string;extraBranchMonthlyMinor:string;
  includedBranches:number;annualMonthsCharged:number;
  status:string;createdByUserId:number;reviewedByUserId:number|null;
  reviewedAt:Date|string|null;
};
export type CatalogReleaseCandidate = {
  mode:'commercial_release_preparation';
  state:'pending_policy';
  sourceProposalId:string;
  industry:string;
  sourceVersion:number;
  sourceDigest:string;
  blockers:readonly CommercialBlocker[];
  canPublish:false;canIssueCustomerQuote:false;
  canAcceptOrder:false;canCheckout:false;canActivate:false;
};

const HEX_SHA256=/^[a-f0-9]{64}$/;
export function assertSourceDigest(value:string):void {
  if(typeof value!=='string'||!HEX_SHA256.test(value))
    throw new CommercialReleaseError('INVALID_DIGEST','بصمة الإصدار غير صالحة',400);
}

/** sha256 over a canonical serialized source, never client amounts or statuses. */
export function prepareCatalogReleaseCandidate(source:ResearchSource):CatalogReleaseCandidate {
  if(!source.proposalId||source.industryCode!=='salon'||!Number.isSafeInteger(source.version)||
     source.version<1||source.currencyCode!=='EGP')
    throw new CommercialReleaseError('SOURCE_UNSUPPORTED','مصدر التسعير غير مدعوم للنشر');
  if(source.status!=='reviewed_research'||!source.reviewedAt||
     !Number.isSafeInteger(source.createdByUserId)||source.createdByUserId<=0||
     !Number.isSafeInteger(source.reviewedByUserId)||source.reviewedByUserId===null||
     source.reviewedByUserId<=0||source.createdByUserId===source.reviewedByUserId)
    throw new CommercialReleaseError('SOURCE_NOT_REVIEWED','يلزم مراجعة بحثية مستقلة أولًا');
  if(typeof source.appPricesJson!=='string'||source.appPricesJson.length>50000||
     !/^\d+$/.test(source.baseMonthlyMinor)||!/^\d+$/.test(source.extraBranchMonthlyMinor)||
     !Number.isSafeInteger(source.includedBranches)||source.includedBranches<1||
     !Number.isSafeInteger(source.annualMonthsCharged)||source.annualMonthsCharged<1)
    throw new CommercialReleaseError('SOURCE_INVALID','نسخة البحث غير سليمة');
  // A digest is not enough: independently validate source prices and app coverage.
  try {
    const parsed:unknown=JSON.parse(source.appPricesJson);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
      throw new CommercialReleaseError('SOURCE_INVALID','بيانات أسعار المصدر غير مكتملة');
    const validated=validateTariffResearchInput({
      industry:'salon',
      pricingModel:source.pricingModel as 'per_app'|'base_plus_apps',
      appPricesMinor:parsed as Record<string,number>,
      baseMonthlyMinor:Number(source.baseMonthlyMinor),
      extraBranchMonthlyMinor:Number(source.extraBranchMonthlyMinor),
      includedBranches:source.includedBranches,
      annualMonthsCharged:source.annualMonthsCharged,
    });
    if(Object.keys(validated.appPricesMinor).length===0)
      throw new CommercialReleaseError('SOURCE_INVALID','تطبيقات المصدر غير مكتملة');
  }catch(error){
    if(error instanceof CommercialReleaseError)throw error;
    if(error instanceof ResearchTariffError||error instanceof SyntaxError)
      throw new CommercialReleaseError('SOURCE_INVALID','الأرقام البحثية غير سليمة أو ناقصة');
    throw error;
  }
  const canonical=JSON.stringify([
    source.proposalId.toLowerCase(),source.industryCode,source.version,
    source.pricingModel,source.currencyCode,source.appPricesJson,
    source.baseMonthlyMinor,source.extraBranchMonthlyMinor,
    source.includedBranches,source.annualMonthsCharged,
  ]);
  const digest=createHash('sha256').update(canonical).digest('hex');
  return {
    mode:'commercial_release_preparation',state:'pending_policy',
    sourceProposalId:source.proposalId,industry:source.industryCode,sourceVersion:source.version,
    sourceDigest:digest,blockers:COMMERCIAL_RELEASE_BLOCKERS,
    canPublish:false,canIssueCustomerQuote:false,canAcceptOrder:false,
    canCheckout:false,canActivate:false,
  };
}

/**
 * A researched proposal cannot be promoted to a saleable catalog.
 * Future release logic must be distinct, reviewed and gated by actual decisions.
 */
export function assertNoCommercialRelease(candidate:CatalogReleaseCandidate):never {
  assertSourceDigest(candidate.sourceDigest);
  throw new CommercialReleaseError('BUSINESS_APPROVAL_REQUIRED',
    'لا يمكن نشر كتالوج للبيع قبل اعتماد جميع شروط التسعير والضرائب والدفع والتجارب');
}
