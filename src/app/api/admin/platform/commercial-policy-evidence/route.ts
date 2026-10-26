import {NextResponse} from 'next/server';
import {isAuthResult,requirePlatformOperator} from '@/lib/api-auth';
import {
  listCommercialPolicyEvidence,submitCommercialPolicyEvidence,reviewCommercialPolicyEvidence,
} from '@/platform/commercial/commercialPolicyEvidenceService';
import {
  PolicyEvidenceError,POLICY_REVIEW_ACTIONS,type PolicyReviewAction,
} from '@/platform/commercial/commercialPolicyEvidencePolicy';
import {CommercialReleaseError} from '@/platform/commercial/commercialReleasePolicy';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function failed(err:unknown){
 if(err instanceof PolicyEvidenceError||err instanceof CommercialReleaseError)
  return NextResponse.json({code:err.code,error:err.message,canPublish:false,canCheckout:false},
   {status:err.status,headers:HEADERS});
 console.error('[commercial-policy-evidence]',err instanceof Error?err.message:err);
 return NextResponse.json({code:'POLICY_EVIDENCE_UNAVAILABLE',error:'تعذر مراجعة مستند الاعتماد',
   canPublish:false,canCheckout:false},{status:503,headers:HEADERS});
}
export async function GET(req:Request){
 const auth=await requirePlatformOperator();
 if(!isAuthResult(auth))return auth;
 const u=new URL(req.url),values=u.searchParams.getAll('candidateId');
 if([...u.searchParams.keys()].some(k=>k!=='candidateId')||
    values.length!==1||!UUID.test(values[0]??''))
  return NextResponse.json({error:'معرف الإصدار غير صالح',code:'INVALID_REQUEST'},
   {status:400,headers:HEADERS});
 try{return NextResponse.json(await listCommercialPolicyEvidence(values[0]!),{headers:HEADERS});}
 catch(err){return failed(err);}
}
export async function POST(req:Request){
 const auth=await requirePlatformOperator();
 if(!isAuthResult(auth))return auth;
 let data:{candidateId:string;blockerCode:string;evidenceText:string};
 try{
  const raw:unknown=await req.json();
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid');
  const b=raw as Record<string,unknown>;
  if(Object.keys(b).length!==3||
     Object.keys(b).some(k=>!['candidateId','blockerCode','evidenceText'].includes(k))||
     typeof b.candidateId!=='string'||!UUID.test(b.candidateId)||
     typeof b.blockerCode!=='string'||typeof b.evidenceText!=='string'||
     !b.evidenceText.trim()||b.evidenceText.length>1000)throw Error('invalid');
  data={candidateId:b.candidateId,blockerCode:b.blockerCode,evidenceText:b.evidenceText};
 }catch{return NextResponse.json({code:'INVALID_REQUEST',error:'بيانات الدليل غير صحيحة'},
  {status:400,headers:HEADERS});}
 try{return NextResponse.json({evidence:await submitCommercialPolicyEvidence({
   ...data,actorUserId:auth.userId,
 }),canPublish:false,canCheckout:false},{status:201,headers:HEADERS});}
 catch(err){return failed(err);}
}
export async function PATCH(req:Request){
 const auth=await requirePlatformOperator();
 if(!isAuthResult(auth))return auth;
 let data:{evidenceId:string;action:PolicyReviewAction;note:string};
 try{
  const raw:unknown=await req.json();
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid');
  const b=raw as Record<string,unknown>;
  if(Object.keys(b).length!==3||
     Object.keys(b).some(k=>!['evidenceId','action','note'].includes(k))||
     typeof b.evidenceId!=='string'||!UUID.test(b.evidenceId)||
     !POLICY_REVIEW_ACTIONS.includes(b.action as PolicyReviewAction)||
     typeof b.note!=='string'||!b.note.trim()||b.note.length>500)throw Error('invalid');
  data={evidenceId:b.evidenceId,action:b.action as PolicyReviewAction,note:b.note};
 }catch{return NextResponse.json({code:'INVALID_REQUEST',error:'مراجعة غير صحيحة'},
  {status:400,headers:HEADERS});}
 try{return NextResponse.json({evidence:await reviewCommercialPolicyEvidence({
   ...data,actorUserId:auth.userId,
 }),canPublish:false,canCheckout:false},{headers:HEADERS});}
 catch(err){return failed(err);}
}
