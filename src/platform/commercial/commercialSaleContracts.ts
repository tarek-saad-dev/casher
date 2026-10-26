/**
 * Pure specifications for the future customer sales flow.
 * These checks NEVER issue a quote, create an order or grant access.
 * There are no customer sale endpoints in this release.
 */
export class CommercialContractError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name='CommercialContractError';}
}
export type FutureCustomerQuote = {
  quoteId:string;tenantId:string;sourceCatalogDigest:string;
  status:'issued'|'accepted'|'expired'|'revoked';
  currency:'EGP';amountMinor:number;
  issuedAtUtc:string;expiresAtUtc:string;acceptedAtUtc:string|null;
};
export type QuoteAcceptanceCheck = {
  quoteId:string;tenantId:string;wouldAllowAcceptance:true;
  doesNotCreateOrder:true;doesNotCharge:true;
};
export function checkFutureQuoteAcceptance(args:{
  quote:FutureCustomerQuote;expectedTenantId:string;nowUtc:string;
}):QuoteAcceptanceCheck {
  const {quote:q}=args;
  if(!q.quoteId||!q.tenantId||q.tenantId!==args.expectedTenantId)
    throw new CommercialContractError('TENANT_MISMATCH','العرض مش تابع للمنشأة');
  if(q.status!=='issued'||q.acceptedAtUtc!==null)
    throw new CommercialContractError('QUOTE_NOT_OPEN','العرض اتقبل أو اتقفل بالفعل');
  if(q.currency!=='EGP'||!Number.isSafeInteger(q.amountMinor)||q.amountMinor<0||
     !/^[a-f0-9]{64}$/.test(q.sourceCatalogDigest))
    throw new CommercialContractError('QUOTE_INVALID','العرض مش مرتبط بكتالوج موثوق');
  const now=Date.parse(args.nowUtc),start=Date.parse(q.issuedAtUtc),
    deadline=Date.parse(q.expiresAtUtc);
  if(!Number.isFinite(now)||!Number.isFinite(start)||!Number.isFinite(deadline)||
     deadline<=start||now<start)
    throw new CommercialContractError('QUOTE_DATES_INVALID','تواريخ العرض غير صحيحة');
  if(now>=deadline)
    throw new CommercialContractError('QUOTE_EXPIRED','انتهت صلاحية عرض السعر');
  return {quoteId:q.quoteId,tenantId:q.tenantId,wouldAllowAcceptance:true,
    doesNotCreateOrder:true,doesNotCharge:true};
}

export type FuturePaymentVerification = {
  orderId:string;tenantId:string;expectedAmountMinor:number;currency:'EGP';
  providerPaymentId:string|null;
  serverVerified:boolean;
  settledAmountMinor:number|null;
  settlementRecorded:boolean;
  duplicateProviderEvent:boolean;
};
/**
 * Shape-level guard for a FUTURE settlement integration.
 * Not proof that any provider actually sent this data: serverVerified must come
 * from a trustworthy webhook/signature/reconciliation adapter, never browser input.
 */
export function checkFutureSettlementPrerequisites(payment:FuturePaymentVerification):{
  orderId:string;tenantId:string;eligibleForSeparateActivationReview:true;activated:false;
} {
  if(!payment.orderId||!payment.tenantId||
     payment.currency!=='EGP'||!Number.isSafeInteger(payment.expectedAmountMinor)||
     payment.expectedAmountMinor<0)
    throw new CommercialContractError('ORDER_INVALID','الطلب غير صالح');
  if(!payment.providerPaymentId||!payment.serverVerified||
     !payment.settlementRecorded||payment.duplicateProviderEvent||
     payment.settledAmountMinor!==payment.expectedAmountMinor)
    throw new CommercialContractError('PAYMENT_NOT_RECONCILED',
      'لا يمكن التفعيل بمجرد إنشاء عملية دفع أو ظهور رسالة نجاح');
  return {orderId:payment.orderId,tenantId:payment.tenantId,
    eligibleForSeparateActivationReview:true,activated:false};
}
