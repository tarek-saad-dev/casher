import {decemberCheckoutEnabled} from '@/lib/campaigns/december-exam/releaseMode';
import {NextRequest,NextResponse} from 'next/server';
import {requirePageAccess,isAuthResult} from '@/lib/api-auth';
import {getStagingZeroPaymentMethod} from '@/lib/campaigns/december-exam/stagingZeroPayment';
import {quoteDecember,DecemberCheckoutError} from '@/lib/campaigns/december-exam/stagingCheckout';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
export async function POST(req:NextRequest){
 const origin=process.env.DECEMBER_EXAM_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const auth=await requirePageAccess('/income/pos');if(!isAuthResult(auth))return auth;
 if(!decemberCheckoutEnabled())return reply({ok:false,code:'DECEMBER_CHECKOUT_DISABLED'},503);
 const body=await req.json().catch(()=>null);
 if(!body||!Array.isArray(body.items)||body.items.length>100||!body.items.every((x:unknown)=>x!==null&&typeof x==='object'))return reply({ok:false,code:'DECEMBER_INVALID_CART'},400);
 try{
 const q=await quoteDecember({tenantId:auth.tenantId,branchId:auth.activeBranchId,clientId:body.clientId,items:body.items});
 let checkoutAvailable=q.payablePiasters>0;
 if(!checkoutAvailable){try{await getStagingZeroPaymentMethod();checkoutAvailable=true;}catch{/* unavailable until SQL prerequisites */}}
 return reply({ok:true,percent:q.percent,subtotalMinor:q.subtotalMinor,discountMinor:q.discountPiasters,payableMinor:q.payablePiasters,
  rules:q.rules,checkoutAvailable});
 }catch(e){if(e instanceof DecemberCheckoutError)return reply({ok:false,code:e.code},e.status);return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}
