import {
  COMMERCIAL_RELEASE_BLOCKERS,type CommercialBlocker,CommercialReleaseError,
} from './commercialReleasePolicy';

export const POLICY_REVIEW_ACTIONS=['reviewed_internal','changes_requested'] as const;
export type PolicyReviewAction=(typeof POLICY_REVIEW_ACTIONS)[number];

export class PolicyEvidenceError extends Error {
  constructor(readonly code:string,message:string,readonly status=400){
    super(message);this.name='PolicyEvidenceError';
  }
}
export function validatePolicyEvidenceInput(blockerCode:string,text:string):{
  blockerCode:CommercialBlocker;evidenceText:string;
} {
  if(!COMMERCIAL_RELEASE_BLOCKERS.includes(blockerCode as CommercialBlocker))
    throw new PolicyEvidenceError('UNKNOWN_BLOCKER','شرط الإطلاق غير معروف');
  if(typeof text!=='string'||!text.trim()||text.length>1000)
    throw new PolicyEvidenceError('INVALID_EVIDENCE','اكتب دليل أو قرار واضح (بحد أقصى 1000 حرف)');
  return {blockerCode:blockerCode as CommercialBlocker,evidenceText:text.trim()};
}
export function validatePolicyReview(args:{
  status:'submitted'|'reviewed_internal'|'changes_requested';
  submittedByUserId:number;reviewedByUserId:number;
  action:PolicyReviewAction;note:string;
}):string {
  if(args.status!=='submitted')
    throw new PolicyEvidenceError('EVIDENCE_REVIEWED','تمت مراجعة هذا الإصدار',409);
  if(!Number.isSafeInteger(args.reviewedByUserId)||args.reviewedByUserId<=0||
     args.submittedByUserId===args.reviewedByUserId)
    throw new PolicyEvidenceError('INDEPENDENT_REVIEW_REQUIRED',
      'لازم مشغّل مختلف يراجع الدليل',403);
  if(!POLICY_REVIEW_ACTIONS.includes(args.action))
    throw new PolicyEvidenceError('INVALID_ACTION','نتيجة مراجعة غير صالحة');
  if(typeof args.note!=='string'||!args.note.trim()||args.note.length>500)
    throw new PolicyEvidenceError('NOTE_REQUIRED','ملاحظة المراجعة إجبارية بحد أقصى 500 حرف');
  return args.note.trim();
}

/**
 * Internal reviews only. Never remove commercial release blockers from this output;
 * even all reviewed_internal items do not mean permission to publish or bill.
 */
export function summarizePolicyEvidence(
  blockers:readonly CommercialBlocker[],
  rows:readonly {blockerCode:string;revision:number;status:string}[],
):{latestByBlocker:Record<string,{revision:number;status:string}|null>;
  submittedCount:number;reviewedInternalCount:number;canPublish:false} {
  const latestByBlocker:Record<string,{revision:number;status:string}|null>={};
  for(const blocker of blockers)latestByBlocker[blocker]=null;
  for(const r of rows){
    if(!(r.blockerCode in latestByBlocker))continue;
    const prev=latestByBlocker[r.blockerCode];
    if(!prev||r.revision>prev.revision)
      latestByBlocker[r.blockerCode]={revision:r.revision,status:r.status};
  }
  let submittedCount=0,reviewedInternalCount=0;
  for(const v of Object.values(latestByBlocker)){
    if(v?.status==='submitted')submittedCount++;
    if(v?.status==='reviewed_internal')reviewedInternalCount++;
  }
  return {latestByBlocker,submittedCount,reviewedInternalCount,canPublish:false};
}
