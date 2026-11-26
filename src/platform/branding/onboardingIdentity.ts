import { BRAND_LIMITS, BrandProfileValidationError, normalizeColor, type TenantBrandProfile } from './brandProfile';

export type IdentityDraft = {displayName:string;logoUrl:string;primaryColor:string;accentColor:string;receiptFooter:string};
export function identityDraft(profile:TenantBrandProfile):IdentityDraft {
  return {displayName:profile.displayName,logoUrl:profile.logoUrl??'',primaryColor:profile.primaryColor??'',accentColor:profile.accentColor??'',receiptFooter:profile.receiptFooter??''};
}
export function identityPayload(profile:TenantBrandProfile,draft:IdentityDraft) {
  const displayName=draft.displayName.trim();
  const logo=draft.logoUrl.trim();
  const receiptFooter=draft.receiptFooter.trim();
  if(!displayName||displayName.length>BRAND_LIMITS.displayName)throw new BrandProfileValidationError('displayName','اكتب اسمًا ظاهرًا صحيحًا.');
  if(receiptFooter.length>BRAND_LIMITS.receiptFooter)throw new BrandProfileValidationError('receiptFooter','تذييل الفاتورة طويل.');
  if(logo.length>BRAND_LIMITS.logoUrl)throw new BrandProfileValidationError('logoUrl','رابط الشعار طويل.');
  // Preserve an existing same-origin logo without allowing newly supplied arbitrary local paths.
  if(logo&&logo!==profile.logoUrl){
    let url:URL;
    try{url=new URL(logo);}catch{throw new BrandProfileValidationError('logoUrl','استخدم رابط شعار HTTPS مباشر.');}
    if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new BrandProfileValidationError('logoUrl','استخدم رابط شعار HTTPS مباشر.');
  }
  return {
    displayName, logoUrl:logo||null,
    primaryColor:normalizeColor(draft.primaryColor,'primaryColor'),
    accentColor:normalizeColor(draft.accentColor,'accentColor'),
    receiptFooter:receiptFooter||null,
    phone:profile.phone,address:profile.address,timezone:profile.timezone,publicBookingOrigins:profile.publicBookingOrigins,
    expectedRevision:profile.revision,
  };
}
