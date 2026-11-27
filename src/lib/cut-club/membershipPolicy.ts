/**
 * CUT CLUB membership policy evaluator, separate from loyalty tier, wallet,
 * discount settlement and account activation. Preview only until persistence,
 * authoritative evidence and invoice-time enforcement are reviewed.
 */
export const membershipKinds=['GENERAL','STUDENT','DOCTOR','COMPANY'] as const;
export type MembershipKind=typeof membershipKinds[number];
export type MembershipPolicy={
  kind:MembershipKind;enabled:boolean;minimumVisits:number;
  allowedBranchIds:number[];partnerCode:string|null;
};
export type MemberFacts={
  accountStatus:'ACTIVE'|'UNLINKED'|'REVIEW_REQUIRED'|'SUSPENDED';
  completedVisits:number|null;branchId:number;
  proof:{kind:Exclude<MembershipKind,'GENERAL'>;verified:boolean;partnerCode:string|null;expiresAt:string|null}|null;
};
export type EligibilityReason='PROGRAM_DISABLED'|'ACCOUNT_NOT_ACTIVE'|'BRANCH_NOT_ELIGIBLE'|'VISITS_UNVERIFIED'|'VISITS_INSUFFICIENT'|'PROOF_REQUIRED'|'PROOF_EXPIRED'|'PARTNER_MISMATCH';
export type Eligibility={eligible:boolean;reasons:EligibilityReason[]};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const partner=(v:unknown):v is string|null=>v===null||(typeof v==='string'&&/^[A-Z0-9_-]{1,40}$/.test(v));
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function parseMembershipPreview(input:unknown):{policy:MembershipPolicy;facts:MemberFacts}|null{
  if(!record(input)||!exact(input,['policy','facts'])||!record(input.policy)||!record(input.facts))return null;
  const p=input.policy,f=input.facts;
  if(!exact(p,['kind','enabled','minimumVisits','allowedBranchIds','partnerCode'])||
     !membershipKinds.includes(p.kind as MembershipKind)||typeof p.enabled!=='boolean'||
     !integer(p.minimumVisits,0,100000)||!Array.isArray(p.allowedBranchIds)||p.allowedBranchIds.length>100||
     !p.allowedBranchIds.every(x=>integer(x,1,2147483647))||new Set(p.allowedBranchIds).size!==p.allowedBranchIds.length||
     !partner(p.partnerCode)||(p.kind==='GENERAL'&&p.partnerCode!==null))return null;
  if(!exact(f,['accountStatus','completedVisits','branchId','proof'])||
     !['ACTIVE','UNLINKED','REVIEW_REQUIRED','SUSPENDED'].includes(f.accountStatus as string)||
     (f.completedVisits!==null&&!integer(f.completedVisits,0,100000))||!integer(f.branchId,1,2147483647))return null;
  if(f.proof!==null){
    const e=f.proof;
    if(!record(e)||!exact(e,['kind','verified','partnerCode','expiresAt'])||
       !['STUDENT','DOCTOR','COMPANY'].includes(e.kind as string)||typeof e.verified!=='boolean'||
       !partner(e.partnerCode)||(e.expiresAt!==null&&!date(e.expiresAt)))return null;
  }
  return {policy:p as MembershipPolicy,facts:f as MemberFacts};
}
export function evaluateMembershipEligibility(policy:MembershipPolicy,facts:MemberFacts,now:Date):Eligibility{
  const reasons:EligibilityReason[]=[];
  if(!policy.enabled)reasons.push('PROGRAM_DISABLED');
  // An unlinked identity is not yet an authoritative Casher customer.
  if(facts.accountStatus!=='ACTIVE')reasons.push('ACCOUNT_NOT_ACTIVE');
  // Empty scope is deliberately closed, never interpreted as all branches.
  if(!policy.allowedBranchIds.includes(facts.branchId))reasons.push('BRANCH_NOT_ELIGIBLE');
  if(policy.minimumVisits>0){
    if(facts.completedVisits===null)reasons.push('VISITS_UNVERIFIED');
    else if(facts.completedVisits<policy.minimumVisits)reasons.push('VISITS_INSUFFICIENT');
  }
  if(policy.kind!=='GENERAL'){
    const proof=facts.proof;
    if(!proof||!proof.verified||proof.kind!==policy.kind)reasons.push('PROOF_REQUIRED');
    else{
      if(!proof.expiresAt||!Number.isFinite(now.getTime())||Date.parse(proof.expiresAt)<=now.getTime())reasons.push('PROOF_EXPIRED');
      if(policy.partnerCode!==null&&proof.partnerCode!==policy.partnerCode)reasons.push('PARTNER_MISMATCH');
    }
  }
  return {eligible:reasons.length===0,reasons};
}
