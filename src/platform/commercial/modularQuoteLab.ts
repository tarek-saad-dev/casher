import { SALON_PACK } from '@/packs/salon/public';
import { getAppInstallDependencies } from '@/platform/apps/appCatalog';
import {
  calculateModularResearchQuote, type ModularResearchQuote,
  type ModularResearchCatalog, type ModularResearchRules,
} from './modularQuoteEngine';
import {
  RESEARCH_SALON_APPS, ResearchTariffError, validateTariffResearchInput,
} from './tariffResearchPolicy';

export const QUOTE_LAB_SALE_BLOCKERS = [
  'UNAPPROVED_COMMERCIAL_TARIFF',
  'TAX_AND_GATEWAY_FEES_UNRESOLVED',
  'TRIAL_FREE_ALLOWANCE_AND_USAGE_TARIFFS_UNRESOLVED',
  'REFUNDS_PRORATION_AND_TERMS_UNRESOLVED',
  'CHECKOUT_SETTLEMENT_AND_ENTITLEMENTS_NOT_LIVE',
] as const;

export class ModularQuoteLabError extends Error {
  constructor(readonly code:string,message:string,readonly status=409) {
    super(message);this.name='ModularQuoteLabError';
  }
}
export type ResearchInquirySnapshot = {
  requestId:string;tenantId:string;tenantCode:string;
  status:'awaiting_pricing'|'closed';
  industry:string;draftRevision:number;apps:readonly string[];
  branches:number;billingCycle:'monthly'|'annual';
};
export type ReviewedTariffSnapshot = {
  proposalId:string;industry:string;version:number;
  status:'submitted'|'reviewed_research'|'changes_requested';
  createdByUserId:number;reviewedByUserId:number|null;
  reviewedAt:string|null;reviewNote:string|null;
  pricingModel:'per_app'|'base_plus_apps';
  appPricesMinor:Record<string,number>;baseMonthlyMinor:number;
  extraBranchMonthlyMinor:number;includedBranches:number;
  annualMonthsCharged:number;currency:'EGP';
};
export type QuoteLabSimulation = {
  mode:'operator_internal_research_simulation';
  source:'versioned_research_proposal_and_tenant_inquiry';
  requestId:string;tenantId:string;tenantCode:string;
  proposalId:string;proposalVersion:number;pricingModel:string;
  commercialBlockers:readonly string[];
  researchQuote:ModularResearchQuote;
  canIssueCustomerQuote:false;canAcceptOrder:false;canCheckout:false;
  canActivate:false;paid:false;orderCreated:false;subscriptionChanged:false;
};

const APP_LABELS:Record<string,string>={
  booking:'الحجوزات',queue:'الدور',pos:'نقطة البيع',
  attendance:'الحضور',payroll:'الرواتب',
  treasury:'تحليلات الخزنة المتقدمة',reports:'التقارير المتقدمة',
};

/**
 * Fully deterministic internal scenario based on immutable inquiry/research snapshots.
 * Does not produce a payable quote. Every caller must enforce operator RBAC.
 */
export function simulateModularResearchInquiry(
  inquiry:ResearchInquirySnapshot, proposal:ReviewedTariffSnapshot,
):QuoteLabSimulation {
  if(inquiry.status!=='awaiting_pricing')
    throw new ModularQuoteLabError('INQUIRY_CLOSED','الطلب مقفول، مينفعش تعمل له محاكاة جديدة');
  if(inquiry.industry!=='salon'||proposal.industry!=='salon'||
     inquiry.industry!==proposal.industry)
    throw new ModularQuoteLabError('INDUSTRY_MISMATCH','المقترح وطلب العميل لازم يكونوا لنفس النشاط');
  if(!inquiry.tenantId||!inquiry.tenantCode||!inquiry.requestId||
     !Number.isSafeInteger(inquiry.draftRevision)||inquiry.draftRevision<1)
    throw new ModularQuoteLabError('INQUIRY_INVALID','بيانات الطلب غير مكتملة');
  if(proposal.status!=='reviewed_research'||!proposal.reviewedAt||
     !proposal.reviewNote?.trim()||
     !Number.isSafeInteger(proposal.createdByUserId)||proposal.createdByUserId<=0||
     !Number.isSafeInteger(proposal.reviewedByUserId)||proposal.reviewedByUserId===null||proposal.reviewedByUserId<=0||
     proposal.reviewedByUserId===proposal.createdByUserId)
    throw new ModularQuoteLabError('RESEARCH_NOT_INDEPENDENTLY_REVIEWED',
      'مطلوب مراجعة بحثية مستقلة قبل إجراء المحاكاة');
  if(!proposal.proposalId||!Number.isSafeInteger(proposal.version)||proposal.version<1||
     proposal.currency!=='EGP')
    throw new ModularQuoteLabError('RESEARCH_INVALID','نسخة البحث غير صالحة');
  try {
    const validated=validateTariffResearchInput({
      industry:'salon',pricingModel:proposal.pricingModel,
      appPricesMinor:proposal.appPricesMinor,
      baseMonthlyMinor:proposal.baseMonthlyMinor,
      extraBranchMonthlyMinor:proposal.extraBranchMonthlyMinor,
      includedBranches:proposal.includedBranches,
      annualMonthsCharged:proposal.annualMonthsCharged,
    });
    const prices:Record<string,number>={...validated.appPricesMinor};
    const catalog:ModularResearchCatalog={
      catalogId:'research-salon-v'+proposal.version,
      version:proposal.version,
      state:'research_only',currency:'EGP',industry:'salon',
      monthlyPerAppMinor:prices,baseMonthlyMinor:validated.baseMonthlyMinor,
      extraBranchMonthlyMinor:validated.extraBranchMonthlyMinor,
      includedBranches:validated.includedBranches,maxBranches:20,
      annualMonthsCharged:validated.annualMonthsCharged,
    };
    const rules:ModularResearchRules={
      requiredApps:SALON_PACK.required,
      eligibleApps:RESEARCH_SALON_APPS,
      dependencies:Object.fromEntries(RESEARCH_SALON_APPS.map(code=>[
        code,getAppInstallDependencies(code as Parameters<typeof getAppInstallDependencies>[0]),
      ])),
      labels:Object.fromEntries(RESEARCH_SALON_APPS.map(code=>[code,APP_LABELS[code]??code])),
    };
    const researchQuote=calculateModularResearchQuote({
      industry:inquiry.industry,apps:inquiry.apps,
      branches:inquiry.branches,cycle:inquiry.billingCycle,
    },catalog,rules);
    return {
      mode:'operator_internal_research_simulation',
      source:'versioned_research_proposal_and_tenant_inquiry',
      requestId:inquiry.requestId,tenantId:inquiry.tenantId,tenantCode:inquiry.tenantCode,
      proposalId:proposal.proposalId,proposalVersion:proposal.version,
      pricingModel:validated.pricingModel,
      commercialBlockers:QUOTE_LAB_SALE_BLOCKERS,
      researchQuote,
      canIssueCustomerQuote:false,canAcceptOrder:false,canCheckout:false,
      canActivate:false,paid:false,orderCreated:false,subscriptionChanged:false,
    };
  }catch(error){
    if(error instanceof ResearchTariffError)
      throw new ModularQuoteLabError(error.code,error.message);
    throw error;
  }
}
