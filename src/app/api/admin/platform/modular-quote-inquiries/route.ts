import {NextResponse} from 'next/server';
import {isAuthResult,requirePlatformOperator} from '@/lib/api-auth';
import {
  closeOperatorQuoteInquiry,listOperatorQuoteInquiries,OperatorInquiryError,
  INQUIRY_REVIEW_OUTCOMES,type InquiryReviewOutcome,
} from '@/platform/commercial/modularInquiryReviewService';

export const runtime='nodejs';export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(error:unknown){
  if(error instanceof OperatorInquiryError)return NextResponse.json(
    {error:error.message,code:error.code,paid:false,orderCreated:false},
    {status:error.status,headers:HEADERS});
  console.error('[platform-modular-inquiries]',error instanceof Error?error.message:error);
  return NextResponse.json({error:'تعذر مراجعة طلب السعر',code:'REVIEW_UNAVAILABLE'},
    {status:503,headers:HEADERS});
}
export async function GET(req:Request){
  const auth=await requirePlatformOperator();
  if(!isAuthResult(auth))return auth;
  const u=new URL(req.url);
  if([...u.searchParams.keys()].some(key=>key!=='status') || u.searchParams.getAll('status').length>1)
    return NextResponse.json({error:'فلتر غير مدعوم',code:'INVALID_FILTER'},
      {status:400,headers:HEADERS});
  const value=u.searchParams.get('status')??'awaiting_pricing';
  if(value!=='awaiting_pricing'&&value!=='closed')
    return NextResponse.json({error:'فلتر غير مدعوم',code:'INVALID_FILTER'},
      {status:400,headers:HEADERS});
  try{
    return NextResponse.json({
      mode:'unpriced_inquiry_review_only',canIssueQuote:false,canAcceptOrder:false,canCheckout:false,
      paid:false,requests:await listOperatorQuoteInquiries(value),
    },{headers:HEADERS});
  }catch(error){return fail(error);}
}
export async function PATCH(req:Request){
  const auth=await requirePlatformOperator();
  if(!isAuthResult(auth))return auth;
  let value:{requestId:string;outcome:InquiryReviewOutcome;note:string};
  try{
    const body:unknown=await req.json();
    if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid');
    const b=body as Record<string,unknown>;
    if(Object.keys(b).length!==3||
        Object.keys(b).some(x=>!['requestId','outcome','note'].includes(x))||
        typeof b.requestId!=='string'||!UUID.test(b.requestId)||
        !INQUIRY_REVIEW_OUTCOMES.includes(b.outcome as InquiryReviewOutcome)||
        typeof b.note!=='string'||b.note.trim().length===0||b.note.length>500)throw Error('invalid');
    value={requestId:b.requestId,outcome:b.outcome as InquiryReviewOutcome,note:b.note.trim()};
  }catch{
    return NextResponse.json({error:'بيانات المراجعة غير صحيحة',code:'INVALID_REQUEST'},
      {status:400,headers:HEADERS});
  }
  try{
    return NextResponse.json(await closeOperatorQuoteInquiry({...value,actorUserId:auth.userId}),
      {headers:HEADERS});
  }catch(error){return fail(error);}
}
