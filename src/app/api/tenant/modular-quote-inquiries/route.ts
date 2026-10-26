import {NextResponse} from 'next/server';
import {isAuthResult} from '@/lib/api-auth';
import {requireTenantBillingAdmin} from '@/platform/commercial/tenantBillingAuth';
import {listTenantQuoteInquiries,requestModularPricing,ModularInquiryError} from '@/platform/commercial/modularQuoteInquiryService';
export const dynamic='force-dynamic';export const runtime='nodejs';
const HEADERS={'Cache-Control':'no-store'};
function failure(err:unknown) {
  if(err instanceof ModularInquiryError) return NextResponse.json(
    {error:err.message,code:err.code,paid:false,orderCreated:false},{status:err.status,headers:HEADERS});
  console.error('[modular-quote-inquiry]',err instanceof Error?err.message:err);
  return NextResponse.json({error:'تعذر تحميل الطلب',code:'INQUIRY_UNAVAILABLE'},
    {status:503,headers:HEADERS});
}
export async function GET() {
  const auth=await requireTenantBillingAdmin();
  if(!isAuthResult(auth))return auth;
  try{return NextResponse.json({mode:'inquiry_only',canCheckout:false,
    requests:await listTenantQuoteInquiries(auth.tenantId)},{headers:HEADERS});}
  catch(err){return failure(err);}
}
export async function POST(req:Request) {
  const auth=await requireTenantBillingAdmin();
  if(!isAuthResult(auth))return auth;
  if(auth.tenant.tenantCode==='CASHER_BOOT')return NextResponse.json(
    {error:'الحساب الأساسي محمي',code:'BOOTSTRAP_TENANT_PROTECTED'},{status:409,headers:HEADERS});
  let revision:number;
  try{
    const json:unknown=await req.json();
    if(!json||typeof json!=='object'||Array.isArray(json))throw Error('invalid');
    const body=json as Record<string,unknown>;
    if(Object.keys(body).length!==1||!Object.hasOwn(body,'expectedDraftRevision')||
      !Number.isSafeInteger(body.expectedDraftRevision)||Number(body.expectedDraftRevision)<1)throw Error('invalid');
    revision=Number(body.expectedDraftRevision);
  }catch{return NextResponse.json({error:'بيانات الطلب غير صحيحة',code:'INVALID_REQUEST'},
    {status:400,headers:HEADERS});}
  try{
    const result=await requestModularPricing({tenantId:auth.tenantId,actorUserId:auth.userId,
      expectedDraftRevision:revision});
    return NextResponse.json(result,{status:200,headers:HEADERS});
  }catch(err){return failure(err);}
}
