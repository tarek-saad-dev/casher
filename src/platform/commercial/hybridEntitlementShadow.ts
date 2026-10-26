/**
 * DRVO Hybrid SaaS commercial access — pure SHADOW policy.
 *
 * A technical installation, active legacy subscription, pricing inquiry, or trial
 * never implies a verified PAID feature grant. No effect on route auth or billing.
 * Free Forever and pricing are unapproved: the only free state is an explicit
 * future policy input; absent explicit approval, fail closed.
 */
export type HybridEntitlementSource='trial'|'free_forever'|'paid'|'platform_core';
export type HybridEntitlementResult={
  mode:'shadow_only';feature:string;
  installed:boolean;technicalReady:boolean;
  commerciallyAvailable:boolean;
  accessRecommended:boolean;
  reason:'CORE_SAFE'|'TRIAL_VALID'|'FREE_POLICY_APPROVED'|'PAID_GRANT_VERIFIED'|
    'APP_NOT_INSTALLED'|'TECHNICALLY_UNAVAILABLE'|'TRIAL_EXPIRED'|'FREE_NOT_APPROVED'|
    'PAID_NOT_VERIFIED'|'NO_VALID_GRANT';
  source:HybridEntitlementSource|null;
  canCharge:false;changesCurrentAccess:false;canActivate:false;
};
export type HybridEntitlementInput={
  feature:string;
  installed:boolean;
  technicalReady:boolean;
  platformCoreSafety:boolean;
  nowEpochMs:number;
  trialEndsEpochMs:number|null;
  trialStartedEpochMs:number|null;
  freeForeverPolicy:{approved:boolean;enabled:boolean;eligibleFeatures:readonly string[]}|null;
  paidGrant:{verified:boolean;feature:string;startsEpochMs:number;endsEpochMs:number|null}|null;
};
/**
 * Observational result only. Do not wire directly to auth without approved
 * policies + implementation rollout and a separate explicit production gate.
 */
export function evaluateHybridEntitlementShadow(input:HybridEntitlementInput):HybridEntitlementResult {
  const base={mode:'shadow_only' as const,feature:input.feature,installed:input.installed,
    technicalReady:input.technicalReady,canCharge:false as const,
    changesCurrentAccess:false as const,canActivate:false as const};
  const result=(reason:HybridEntitlementResult['reason'],source:HybridEntitlementSource|null,
    allowed:boolean):HybridEntitlementResult=>({...base,reason,source,commerciallyAvailable:allowed,accessRecommended:allowed});
  if(input.platformCoreSafety)return result('CORE_SAFE','platform_core',true);
  if(!input.installed)return result('APP_NOT_INSTALLED',null,false);
  if(!input.technicalReady)return result('TECHNICALLY_UNAVAILABLE',null,false);
  const trialValid=Number.isFinite(input.nowEpochMs)&&input.trialStartedEpochMs!==null&&
    input.trialEndsEpochMs!==null&&input.trialEndsEpochMs>input.trialStartedEpochMs&&
    input.nowEpochMs>=input.trialStartedEpochMs&&input.nowEpochMs<input.trialEndsEpochMs;
  if(trialValid)return result('TRIAL_VALID','trial',true);
  const free=input.freeForeverPolicy;
  if(free?.approved&&free.enabled&&free.eligibleFeatures.includes(input.feature))
    return result('FREE_POLICY_APPROVED','free_forever',true);
  const paid=input.paidGrant;
  if(paid?.verified&&paid.feature===input.feature&&
     Number.isFinite(input.nowEpochMs)&&input.nowEpochMs>=paid.startsEpochMs&&
     (paid.endsEpochMs===null||input.nowEpochMs<paid.endsEpochMs))
    return result('PAID_GRANT_VERIFIED','paid',true);
  if(free&&!free.approved&&free.eligibleFeatures.includes(input.feature))
    return result('FREE_NOT_APPROVED',null,false);
  if(paid&&!paid.verified)return result('PAID_NOT_VERIFIED',null,false);
  if(input.trialEndsEpochMs!==null&&input.nowEpochMs>=input.trialEndsEpochMs)
    return result('TRIAL_EXPIRED',null,false);
  return result('NO_VALID_GRANT',null,false);
}
