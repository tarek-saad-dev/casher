import {describe,it,expect} from 'vitest';
import {evaluateHybridEntitlementShadow as evalShadow,type HybridEntitlementInput} from '../commercial/hybridEntitlementShadow';
const base:HybridEntitlementInput={
  feature:'booking',installed:true,technicalReady:true,platformCoreSafety:false,
  nowEpochMs:1000,trialStartedEpochMs:0,trialEndsEpochMs:1209600000,
  freeForeverPolicy:null,paidGrant:null,
};
describe('Hybrid SaaS entitlement planning: no production gates',()=>{
  it('valid trial is a shadow suggestion, not an activation',()=>{
    expect(evalShadow(base)).toMatchObject({reason:'TRIAL_VALID',source:'trial',
      accessRecommended:true,canCharge:false,canActivate:false,changesCurrentAccess:false});
  });
  it('does not accept a trial window longer than approved 14 days',()=>{
    expect(evalShadow({...base,trialEndsEpochMs:15*24*60*60*1000})).toMatchObject({
      reason:'NO_VALID_GRANT',accessRecommended:false});
  });
  it('expired trial cannot silently turn into Free Forever',()=>{
    expect(evalShadow({...base,nowEpochMs:1209600000})).toMatchObject({
      reason:'TRIAL_EXPIRED',accessRecommended:false});
  });
  it('unapproved future free policy denies, approved explicit policy may advise',()=>{
    const f={approved:false,enabled:true,eligibleFeatures:['booking']};
    expect(evalShadow({...base,trialEndsEpochMs:null,freeForeverPolicy:f})).toMatchObject({
      reason:'FREE_NOT_APPROVED',commerciallyAvailable:false});
    expect(evalShadow({...base,trialEndsEpochMs:null,freeForeverPolicy:{...f,approved:true}})).toMatchObject({
      reason:'FREE_POLICY_APPROVED',source:'free_forever',changesCurrentAccess:false});
  });
  it('requires verified paid entitlement for exact feature and bounded period',()=>{
    const grant={verified:true,feature:'booking',startsEpochMs:0,endsEpochMs:2000};
    expect(evalShadow({...base,trialEndsEpochMs:null,paidGrant:grant})).toMatchObject({reason:'PAID_GRANT_VERIFIED'});
    expect(evalShadow({...base,trialEndsEpochMs:null,paidGrant:{...grant,verified:false}})).toMatchObject({
      reason:'PAID_NOT_VERIFIED',accessRecommended:false});
    expect(evalShadow({...base,trialEndsEpochMs:null,paidGrant:{...grant,feature:'pos'}})).toMatchObject({
      reason:'NO_VALID_GRANT'});
    expect(evalShadow({...base,trialEndsEpochMs:null,nowEpochMs:2000,paidGrant:grant})).toMatchObject({
      reason:'NO_VALID_GRANT'});
  });
  it('keeps safety core independent and does not conflate installed with paid',()=>{
    expect(evalShadow({...base,platformCoreSafety:true,installed:false,technicalReady:false})).toMatchObject({
      reason:'CORE_SAFE',canCharge:false,changesCurrentAccess:false});
    expect(evalShadow({...base,installed:false})).toMatchObject({
      reason:'APP_NOT_INSTALLED',accessRecommended:false});
    expect(evalShadow({...base,technicalReady:false})).toMatchObject({reason:'TECHNICALLY_UNAVAILABLE'});
  });
});
