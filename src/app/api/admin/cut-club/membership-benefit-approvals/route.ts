import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {getPool} from '@/lib/db';
import {pilotTenant} from '@/lib/cut-club/membershipDraft';
import {BenefitApprovalError,listBenefitApprovals,recordBenefitApproval} from '@/lib/cut-club/membershipBenefitApprovalSql';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
const failure=(e:unknown)=>e instanceof BenefitApprovalError?reply({ok:false,code:e.code},e.status):reply({ok:false,code:'APPROVAL_UNAVAILABLE'},503);
export async function GET(){
 const a=await requireAdmin();if(!isAuthResult(a))return a;
 if(a.tenantId.toLowerCase()!==pilotTenant||process.env.CUT_CLUB_STAGING_MEMBERSHIP_BENEFIT_APPROVAL_ENABLED!=='true')return reply({ok:false,code:'BENEFIT_APPROVAL_NOT_RELEASED'},403);
 try{return reply({ok:true,trialOnly:true,benefitsEnabled:false,items:await listBenefitApprovals(await getPool(),{tenantId:a.tenantId,staffId:a.userId})});}catch(e){return failure(e);}
}
export async function POST(req:NextRequest){
 const origin=process.env.CUT_CLUB_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const a=await requireAdmin();if(!isAuthResult(a))return a;
 if(a.tenantId.toLowerCase()!==pilotTenant||process.env.CUT_CLUB_STAGING_MEMBERSHIP_BENEFIT_APPROVAL_ENABLED!=='true')return reply({ok:false,code:'BENEFIT_APPROVAL_NOT_RELEASED'},403);
 const raw=await req.text().catch(()=>null);if(!raw||raw.length>2048)return reply({ok:false,code:'INVALID_APPROVAL'},400);
 let value:unknown;try{value=JSON.parse(raw);}catch{return reply({ok:false,code:'INVALID_APPROVAL'},400);}
 try{return reply({ok:true,trialOnly:true,benefitsEnabled:false,...await recordBenefitApproval(await getPool(),{tenantId:a.tenantId,staffId:a.userId},value)},201);}catch(e){return failure(e);}
}
