import {NextResponse} from 'next/server';
import {isAuthResult,requirePlatformOperator} from '@/lib/api-auth';
import {createInternalQuoteSnapshot,listInternalQuoteSnapshots} from '@/platform/commercial/internalQuoteSnapshotService';
import {InternalQuoteSnapshotError} from '@/platform/commercial/internalQuoteSnapshotPolicy';
import {ModularQuoteLabError} from '@/platform/commercial/modularQuoteLab';
import {ModularQuoteError} from '@/platform/commercial/modularQuoteEngine';
import {CommercialReleaseError} from '@/platform/commercial/commercialReleasePolicy';
import {BootstrapTenantProtectedError} from '@/platform/commercial/bootstrapGuard';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(error:unknown){
 if(error instanceof InternalQuoteSnapshotError||error instanceof ModularQuoteLabError||
    error instanceof ModularQuoteError||error instanceof CommercialReleaseError||
    error instanceof BootstrapTenantProtectedError){
   const status='status' in error&&typeof error.status==='number'?error.status:409;
   return NextResponse.json({error:error.message,code:error.code,
      canIssueCustomerQuote:false,canAcceptOrder:false,canCheckout:false,paid:false},
     {status,headers:HEADERS});
 }
 console.error('[internal-research-quote-snapshots]',error instanceof Error?error.message:error);
 return NextResponse.json({error:'تعذر حفظ المحاكاة الداخلية',code:'SNAPSHOT_UNAVAILABLE',
    canIssueCustomerQuote:false,canCheckout:false},{status:503,headers:HEADERS});
}
export async function GET(){
 const auth=await requirePlatformOperator();
 if(!isAuthResult(auth))return auth;
 try{return NextResponse.json({
   mode:'internal_research_snapshots',canIssueCustomerQuote:false,
   canAcceptOrder:false,canCheckout:false,canActivate:false,paid:false,
   snapshots:await listInternalQuoteSnapshots(),
 },{headers:HEADERS});}
 catch(error){return fail(error);}
}
export async function POST(req:Request){
 const auth=await requirePlatformOperator();
 if(!isAuthResult(auth))return auth;
 let input:{requestId:string;candidateId:string};
 try{
  const raw:unknown=await req.json();
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid');
  const b=raw as Record<string,unknown>;
  if(Object.keys(b).length!==2||
    Object.keys(b).some(k=>!['requestId','candidateId'].includes(k))||
    typeof b.requestId!=='string'||!UUID.test(b.requestId)||
    typeof b.candidateId!=='string'||!UUID.test(b.candidateId))throw Error('invalid');
  input={requestId:b.requestId,candidateId:b.candidateId};
 }catch{return NextResponse.json({error:'اختار طلبًا وملف بحث موجودين',code:'INVALID_REQUEST',
   canIssueCustomerQuote:false,canCheckout:false},{status:400,headers:HEADERS});}
 try{
  return NextResponse.json({snapshot:await createInternalQuoteSnapshot({
    ...input,actorUserId:auth.userId,
  }),canIssueCustomerQuote:false,canAcceptOrder:false,canCheckout:false},
  {status:201,headers:HEADERS});
 }catch(error){return fail(error);}
}
