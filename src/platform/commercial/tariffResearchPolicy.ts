import { SALON_PACK } from '@/packs/salon/public';
import { selectableDraftApps } from '@/platform/commercial/modularDraftPolicy';

/**
 * Internal pricing RESEARCH only. Never join with live customer catalogs,
 * customer quotes, entitlements or settlement flows.
 */
export const RESEARCH_TARIFF_MODELS=['per_app','base_plus_apps'] as const;
export type ResearchTariffModel=(typeof RESEARCH_TARIFF_MODELS)[number];
export const RESEARCH_REVIEW_ACTIONS=['reviewed_research','changes_requested'] as const;
export type ResearchReviewAction=(typeof RESEARCH_REVIEW_ACTIONS)[number];
export const RESEARCH_SALON_APPS=selectableDraftApps(SALON_PACK)
  .filter(x=>x.selectable).map(x=>x.code).sort();
export const MAX_MONTHLY_MINOR=1_000_000_000_000; // safety ceiling, NOT a price proposal

export class ResearchTariffError extends Error {
  constructor(readonly code:string,message:string,readonly status=400){
    super(message);this.name='ResearchTariffError';
  }
}
export type TariffResearchInput={
  industry:'salon';
  pricingModel:ResearchTariffModel;
  appPricesMinor:Record<string,number>;
  baseMonthlyMinor:number;
  extraBranchMonthlyMinor:number;
  includedBranches:number;
  annualMonthsCharged:number;
};
function amount(value:unknown,label:string):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||
      value<0||value>MAX_MONTHLY_MINOR)
    throw new ResearchTariffError('INVALID_MINOR_AMOUNT',label+' must be a safe non-negative integer minor unit');
  return value;
}
export function validateTariffResearchInput(input:TariffResearchInput):TariffResearchInput {
  if(input.industry!=='salon')
    throw new ResearchTariffError('UNSUPPORTED_INDUSTRY','الأسعار البحثية مدعومة للصالونات فقط',409);
  if(!RESEARCH_TARIFF_MODELS.includes(input.pricingModel))
    throw new ResearchTariffError('INVALID_MODEL','نموذج التسعير غير مدعوم');
  if(!Number.isSafeInteger(input.includedBranches)||input.includedBranches<1||input.includedBranches>20)
    throw new ResearchTariffError('INVALID_BRANCHES','اختار عدد فروع بين 1 و20');
  if(!Number.isSafeInteger(input.annualMonthsCharged)||input.annualMonthsCharged<1||input.annualMonthsCharged>12)
    throw new ResearchTariffError('INVALID_ANNUAL_RULE','عدد شهور التحصيل السنوي لازم يكون بين 1 و12');
  const obj=input.appPricesMinor;
  if(!obj||typeof obj!=='object'||Array.isArray(obj))
    throw new ResearchTariffError('MISSING_APP_PRICES','لازم تدخل كل افتراضات أسعار التطبيقات');
  const received=Object.keys(obj).sort();
  if(received.length!==RESEARCH_SALON_APPS.length||
     received.some((c,i)=>c!==RESEARCH_SALON_APPS[i]))
    throw new ResearchTariffError('INCOMPLETE_APP_PRICES','لازم تسجل قيمة لكل تطبيق متاح؛ بدون أسعار إضافية');
  const prices:Record<string,number>={};
  for(const app of RESEARCH_SALON_APPS)prices[app]=amount(obj[app],app);
  const baseMonthlyMinor=amount(input.baseMonthlyMinor,'base fee');
  const extraBranchMonthlyMinor=amount(input.extraBranchMonthlyMinor,'branch fee');
  const baseTotal=RESEARCH_SALON_APPS.reduce((sum,code)=>sum+prices[code]!,baseMonthlyMinor);
  const worstMonthly=baseTotal+extraBranchMonthlyMinor*19;
  if(!Number.isSafeInteger(worstMonthly*input.annualMonthsCharged))
    throw new ResearchTariffError('AMOUNT_OVERFLOW','البحث السعري يتجاوز الحدود الرقمية الآمنة');
  return {industry:'salon',pricingModel:input.pricingModel,appPricesMinor:prices,
    baseMonthlyMinor,extraBranchMonthlyMinor,
    includedBranches:input.includedBranches,annualMonthsCharged:input.annualMonthsCharged};
}
export function validateIndependentReview(args:{
  creatorId:number;reviewerId:number;status:'submitted'|'reviewed_research'|'changes_requested';
  action:ResearchReviewAction;note:string;
}):string {
  if(args.status!=='submitted')
    throw new ResearchTariffError('ALREADY_REVIEWED','تمت مراجعة النسخة بالفعل',409);
  if(!Number.isSafeInteger(args.reviewerId)||args.reviewerId<=0||args.creatorId===args.reviewerId)
    throw new ResearchTariffError('SEPARATION_REQUIRED','لازم موظف مختلف يراجع المقترح',403);
  if(!RESEARCH_REVIEW_ACTIONS.includes(args.action))
    throw new ResearchTariffError('INVALID_REVIEW_ACTION','نتيجة المراجعة غير مدعومة');
  if(typeof args.note!=='string'||args.note.trim().length===0||args.note.length>500)
    throw new ResearchTariffError('REVIEW_NOTE_REQUIRED','اكتب سبب المراجعة (حتى 500 حرف)');
  return args.note.trim();
}
