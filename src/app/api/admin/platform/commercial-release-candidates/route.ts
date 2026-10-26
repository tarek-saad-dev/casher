import { NextResponse } from 'next/server';
import {isAuthResult,requirePlatformOperator} from '@/lib/api-auth';
import {
  createCommercialReleaseCandidate,listCommercialReleaseCandidates,
} from '@/platform/commercial/commercialReleaseService';
import {CommercialReleaseError} from '@/platform/commercial/commercialReleasePolicy';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(error:unknown){
  if(error instanceof CommercialReleaseError)
    return NextResponse.json({error:error.message,code:error.code,canPublish:false,canCheckout:false},
      {status:error.status,headers:HEADERS});
  console.error('[commercial-release-candidates]',error instanceof Error?error.message:error);
  return NextResponse.json({error:'تعذر تجهيز إصدار الكتالوج',code:'CANDIDATE_UNAVAILABLE',
    canPublish:false,canCheckout:false},{status:503,headers:HEADERS});
}
export async function GET(){
  const auth=await requirePlatformOperator();
  if(!isAuthResult(auth))return auth;
  try{return NextResponse.json({mode:'commercial_release_preparation',canPublish:false,
    canIssueCustomerQuote:false,canCheckout:false,
    candidates:await listCommercialReleaseCandidates()},{headers:HEADERS});}
  catch(error){return failure(error);}
}
export async function POST(req:Request){
  const auth=await requirePlatformOperator();
  if(!isAuthResult(auth))return auth;
  let sourceProposalId:string;
  try{
    const value:unknown=await req.json();
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid');
    const b=value as Record<string,unknown>;
    if(Object.keys(b).length!==1||typeof b.sourceProposalId!=='string'||
       !UUID.test(b.sourceProposalId))throw Error('invalid');
    sourceProposalId=b.sourceProposalId;
  }catch{return NextResponse.json({error:'اختار إصدار بحثي للمراجعة',code:'INVALID_REQUEST',
    canPublish:false,canCheckout:false},{status:400,headers:HEADERS});}
  try{
    return NextResponse.json({candidate:await createCommercialReleaseCandidate({
      sourceProposalId,actorUserId:auth.userId}),canPublish:false,canCheckout:false},
    {headers:HEADERS});
  }catch(error){return failure(error);}
}
