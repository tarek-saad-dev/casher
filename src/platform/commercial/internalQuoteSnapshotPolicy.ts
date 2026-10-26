import {createHash} from 'node:crypto';
import type {QuoteLabSimulation} from './modularQuoteLab';

export const INTERNAL_SNAPSHOT_TTL_HOURS=48 as const;
export class InternalQuoteSnapshotError extends Error {
  constructor(readonly code:string,message:string,readonly status=409){
    super(message);this.name='InternalQuoteSnapshotError';
  }
}
export type InternalQuoteSnapshotSource={
  requestId:string;tenantId:string;candidateId:string;sourceDigest:string;
  researchVersion:number;draftRevision:number;
  simulation:QuoteLabSimulation;
};
export type InternalQuoteSnapshotPayload={
  snapshotId:string;requestId:string;tenantId:string;candidateId:string;
  sourceDigest:string;researchVersion:number;draftRevision:number;
  researchQuote:QuoteLabSimulation['researchQuote'];
  quoteDigest:string;createdAt:string;expiresAt:string;
  status:'internal_only';availability:'internal_current'|'internal_expired';
  canIssueCustomerQuote:false;canAcceptOrder:false;canCheckout:false;
  canActivate:false;paid:false;orderCreated:false;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const utc=(s:string)=>{
  const ms=Date.parse(s);
  if(!Number.isFinite(ms)||!s.endsWith('Z'))throw new InternalQuoteSnapshotError('INVALID_TIMESTAMP','تاريخ غير صالح');
  return ms;
};
function assertInternalQuote(q:QuoteLabSimulation['researchQuote']):void {
  if(!q||q.kind!=='internal_research_only'||q.canCheckout!==false||
     q.canActivate!==false||q.approvedForSale!==false||q.currency!=='EGP'||
     !Array.isArray(q.lines)||!Array.isArray(q.apps)||
     !Number.isSafeInteger(q.totalMonthlyMinor)||q.totalMonthlyMinor<0||
     !Number.isSafeInteger(q.totalPeriodMinor)||q.totalPeriodMinor<0||
     !Number.isSafeInteger(q.chargedMonths)||q.chargedMonths<1||
     !Array.isArray(q.excludedFromEstimate)||
     q.excludedFromEstimate.length!==3||
     q.excludedFromEstimate[0]!=='taxes'||
     q.excludedFromEstimate[1]!=='gateway_fees'||
     q.excludedFromEstimate[2]!=='usage_based_services')
    throw new InternalQuoteSnapshotError('QUOTE_NOT_INTERNAL','النتيجة مش محاكاة داخلية صالحة');
  let total=0;
  for(const line of q.lines){
    if(!line||!Number.isSafeInteger(line.quantity)||line.quantity<1||
       !Number.isSafeInteger(line.unitMonthlyMinor)||line.unitMonthlyMinor<0||
       !Number.isSafeInteger(line.totalMonthlyMinor)||line.totalMonthlyMinor<0||
       !Number.isSafeInteger(line.unitMonthlyMinor*line.quantity)||
       line.totalMonthlyMinor!==line.unitMonthlyMinor*line.quantity)
      throw new InternalQuoteSnapshotError('QUOTE_MISMATCH','تفاصيل المحاكاة غير متطابقة');
    total+=line.totalMonthlyMinor;
    if(!Number.isSafeInteger(total))
      throw new InternalQuoteSnapshotError('QUOTE_OVERFLOW','إجمالي غير صالح');
  }
  if(total!==q.totalMonthlyMinor||
     q.totalMonthlyMinor*q.chargedMonths!==q.totalPeriodMinor||
     !Number.isSafeInteger(q.totalMonthlyMinor*q.chargedMonths))
    throw new InternalQuoteSnapshotError('QUOTE_MISMATCH','الإجمالي لا يساوي البنود');
}
function hashQuote(data:Omit<InternalQuoteSnapshotPayload,
  'quoteDigest'|'status'|'availability'|'canIssueCustomerQuote'|'canAcceptOrder'|
  'canCheckout'|'canActivate'|'paid'|'orderCreated'>):string {
  return createHash('sha256').update(JSON.stringify([
    data.snapshotId.toLowerCase(),data.requestId.toLowerCase(),
    data.tenantId.toLowerCase(),data.candidateId.toLowerCase(),
    data.sourceDigest,data.researchVersion,data.draftRevision,
    data.researchQuote,data.createdAt,data.expiresAt,
  ])).digest('hex');
}
/** Internal 48h validity is not a future binding customer quote expiration policy. */
export function makeInternalQuoteSnapshot(args:{
  snapshotId:string;source:InternalQuoteSnapshotSource;
  createdAt:string;
}):InternalQuoteSnapshotPayload {
  const s=args.source;
  if(!UUID.test(args.snapshotId)||!UUID.test(s.requestId)||!UUID.test(s.tenantId)||
     !UUID.test(s.candidateId)||!SHA.test(s.sourceDigest)||
     !Number.isSafeInteger(s.researchVersion)||s.researchVersion<1||
     !Number.isSafeInteger(s.draftRevision)||s.draftRevision<1)
    throw new InternalQuoteSnapshotError('SOURCE_INVALID','بيانات المحاكاة غير مكتملة');
  if(s.simulation.mode!=='operator_internal_research_simulation'||
     s.simulation.canIssueCustomerQuote!==false||s.simulation.canAcceptOrder!==false||
     s.simulation.canCheckout!==false||s.simulation.canActivate!==false||
     s.simulation.paid!==false||s.simulation.orderCreated!==false||
     s.simulation.subscriptionChanged!==false||
     s.simulation.requestId.toLowerCase()!==s.requestId.toLowerCase()||
     s.simulation.tenantId.toLowerCase()!==s.tenantId.toLowerCase()||
     s.simulation.proposalVersion!==s.researchVersion)
    throw new InternalQuoteSnapshotError('SIMULATION_MISMATCH','مصدر المحاكاة مختلف عن الطلب');
  assertInternalQuote(s.simulation.researchQuote);
  const created=utc(args.createdAt);
  if(created%1000!==0)
    throw new InternalQuoteSnapshotError('TIME_PRECISION','وقت إصدار المحاكاة لازم يكون بالثواني الكاملة');
  const expiresAt=new Date(created+INTERNAL_SNAPSHOT_TTL_HOURS*60*60*1000).toISOString();
  const data={
    snapshotId:args.snapshotId.toLowerCase(),requestId:s.requestId.toLowerCase(),
    tenantId:s.tenantId.toLowerCase(),candidateId:s.candidateId.toLowerCase(),
    sourceDigest:s.sourceDigest,researchVersion:s.researchVersion,draftRevision:s.draftRevision,
    researchQuote:s.simulation.researchQuote,createdAt:new Date(created).toISOString(),expiresAt,
  };
  return {
    ...data,quoteDigest:hashQuote(data),status:'internal_only',
    availability:'internal_current',
    canIssueCustomerQuote:false,canAcceptOrder:false,canCheckout:false,
    canActivate:false,paid:false,orderCreated:false,
  };
}
/** Fail closed on changed persisted data, expired snapshots remain visible as audit records only. */
export function verifyInternalQuoteSnapshot(
  payload:InternalQuoteSnapshotPayload,nowUtc:string,
):InternalQuoteSnapshotPayload {
  if(payload.status!=='internal_only'||!SHA.test(payload.quoteDigest)||!SHA.test(payload.sourceDigest)||
     !UUID.test(payload.snapshotId)||!UUID.test(payload.tenantId)||
     !UUID.test(payload.requestId)||!UUID.test(payload.candidateId))
    throw new InternalQuoteSnapshotError('SNAPSHOT_INVALID','ملف المحاكاة غير سليم');
  assertInternalQuote(payload.researchQuote);
  const created=utc(payload.createdAt),expires=utc(payload.expiresAt),now=utc(nowUtc);
  if(expires-created!==INTERNAL_SNAPSHOT_TTL_HOURS*60*60*1000)
    throw new InternalQuoteSnapshotError('SNAPSHOT_EXPIRY_TAMPERED','صلاحية المحاكاة غير سليمة');
  const digest=hashQuote(payload);
  if(digest!==payload.quoteDigest)
    throw new InternalQuoteSnapshotError('SNAPSHOT_TAMPERED','بصمة الملف لا تطابق المحتوى');
  return {
    ...payload,availability:now>=expires?'internal_expired':'internal_current',
    canIssueCustomerQuote:false,canAcceptOrder:false,canCheckout:false,
    canActivate:false,paid:false,orderCreated:false,
  };
}
