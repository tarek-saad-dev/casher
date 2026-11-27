/** Nonfinancial configuration drafts. Never an authorization to discount a sale. */
export const benefitKinds=['PERCENT_DISCOUNT','FREE_SERVICE','FIXED_PRICE','BONUS_COINS'] as const;
export type BenefitKind=typeof benefitKinds[number];
export type BenefitRule={code:string;kind:BenefitKind;serviceId:number;value:number;maxUsesPerMembership:number;maxUsesPerInvoice:number;branchIds:(1|3)[]};
export type BenefitDraftInput={programCode:string;programRevision:number;expectedRevision:number;rules:BenefitRule[];reason:string};
export type BenefitDraft=Omit<BenefitDraftInput,'expectedRevision'>&{revision:number;createdAt:string};
const rec=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const int=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const key=(v:unknown):v is string=>typeof v==='string'&&/^[A-Z0-9_-]{1,40}$/.test(v);
export function parseBenefitDraft(v:unknown):BenefitDraftInput|null{
 if(!rec(v)||Object.keys(v).sort().join(',')!=='expectedRevision,programCode,programRevision,reason,rules'||!key(v.programCode)||!int(v.programRevision,1,2147483647)||!int(v.expectedRevision,0,2147483646)||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.trim().length>300||!Array.isArray(v.rules)||v.rules.length>20)return null;
 const codes=new Set<string>(),services=new Set<number>();const rules:BenefitRule[]=[];
 for(const r of v.rules){
 if(!rec(r)||Object.keys(r).sort().join(',')!=='branchIds,code,kind,maxUsesPerInvoice,maxUsesPerMembership,serviceId,value'||!key(r.code)||!benefitKinds.includes(r.kind as BenefitKind)||!int(r.serviceId,1,2147483647)||!int(r.maxUsesPerMembership,1,10000)||!int(r.maxUsesPerInvoice,1,100)||r.maxUsesPerInvoice>r.maxUsesPerMembership||!Array.isArray(r.branchIds)||r.branchIds.length<1||r.branchIds.length>2||!r.branchIds.every(b=>b===1||b===3)||new Set(r.branchIds).size!==r.branchIds.length||codes.has(r.code)||services.has(r.serviceId))return null;
 const valid=r.kind==='PERCENT_DISCOUNT'?int(r.value,1,10000):r.kind==='FREE_SERVICE'?r.value===0:r.kind==='FIXED_PRICE'?int(r.value,1,100000000):int(r.value,1,100000);
 if(!valid)return null;
 codes.add(r.code);services.add(r.serviceId);rules.push({...r,branchIds:[...r.branchIds].sort()} as BenefitRule);
 }
 return {programCode:v.programCode,programRevision:v.programRevision,expectedRevision:v.expectedRevision,reason:v.reason.trim(),rules};
}
