/** Production is opt-in and cannot be selected by a browser. The approved
 * release reference and finance decision must be set by the operator. */
export function decemberProductionConfigured(env:NodeJS.ProcessEnv=process.env){
 return env.DECEMBER_EXAM_PRODUCTION_ENABLED==='true'
  && !!env.DECEMBER_EXAM_RELEASE_APPROVAL?.trim()
  && env.DECEMBER_EXAM_COMMISSION_POLICY==='LEGACY_SERVICE_BASE'
  && env.DECEMBER_EXAM_INGRESS_VERIFIED==='true'
  && !!env.DECEMBER_EXAM_PRODUCTION_DB_LOGIN?.trim()
  && /^[0-9a-f-]{36}$/i.test(env.DECEMBER_EXAM_TENANT_ID||'')
  && !!env.DECEMBER_EXAM_BFF_SHARED_KEY && Buffer.byteLength(env.DECEMBER_EXAM_BFF_SHARED_KEY)>=32;
}
export function decemberCheckoutEnabled(){return process.env.DECEMBER_EXAM_STAGING_CHECKOUT_ENABLED==='true'||decemberProductionConfigured();}
export function decemberReferralEnabled(){return process.env.DECEMBER_EXAM_STAGING_REFERRAL_ENABLED==='true'||decemberProductionConfigured();}
export function decemberZeroEnabled(){return process.env.DECEMBER_EXAM_STAGING_ZERO_PAYMENT_ENABLED==='true'||(decemberProductionConfigured()&&process.env.DECEMBER_EXAM_PRODUCTION_ZERO_PAYMENT_ENABLED==='true');}
export function decemberProductionLogin(){return decemberProductionConfigured()?process.env.DECEMBER_EXAM_PRODUCTION_DB_LOGIN!:null;}
