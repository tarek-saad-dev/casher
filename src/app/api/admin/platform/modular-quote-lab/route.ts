import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { simulateStoredModularInquiry } from '@/platform/commercial/modularQuoteLabService';
import { ModularQuoteLabError } from '@/platform/commercial/modularQuoteLab';
import { ModularQuoteError } from '@/platform/commercial/modularQuoteEngine';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Internal operator simulation ONLY: no GET, payment or tenant-facing endpoint. */
export async function POST(req:Request) {
  const auth=await requirePlatformOperator();
  if(!isAuthResult(auth))return auth;
  let ids:{requestId:string;proposalId:string};
  try{
    const body:unknown=await req.json();
    if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid');
    const obj=body as Record<string,unknown>;
    if(Object.keys(obj).length!==2||
       Object.keys(obj).some(k=>!['requestId','proposalId'].includes(k))||
       typeof obj.requestId!=='string'||!UUID.test(obj.requestId)||
       typeof obj.proposalId!=='string'||!UUID.test(obj.proposalId))throw Error('invalid');
    ids={requestId:obj.requestId,proposalId:obj.proposalId};
  }catch{
    return NextResponse.json({error:'اختار طلب عميل ونسخة بحث صالحة',code:'INVALID_REQUEST',
      canIssueCustomerQuote:false,canCheckout:false},
      {status:400,headers:HEADERS});
  }
  try{
    return NextResponse.json(await simulateStoredModularInquiry(ids),{headers:HEADERS});
  }catch(error){
    if(error instanceof ModularQuoteLabError||error instanceof ModularQuoteError)
      return NextResponse.json({error:error.message,code:error.code,canIssueCustomerQuote:false,
        canCheckout:false},{status:error instanceof ModularQuoteLabError?error.status:409,headers:HEADERS});
    console.error('[modular-quote-lab]',error instanceof Error?error.message:error);
    return NextResponse.json({error:'تعذر إجراء المحاكاة الداخلية',code:'SIMULATION_UNAVAILABLE',
      canIssueCustomerQuote:false,canCheckout:false},{status:503,headers:HEADERS});
  }
}
