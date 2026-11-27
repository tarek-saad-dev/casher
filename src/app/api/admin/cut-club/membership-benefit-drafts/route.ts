import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {getPool} from '@/lib/db';
import {BenefitDraftError,listBenefitDrafts,saveBenefitDraft,listBenefitCatalog} from '@/lib/cut-club/membershipBenefitDraftSql';
import {pilotTenant} from '@/lib/cut-club/membershipDraft';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
const failure=(e:unknown)=>e instanceof BenefitDraftError?reply({ok:false,code:e.code},e.status):reply({ok:false,code:'BENEFITS_UNAVAILABLE'},503);
export async function GET(){
 const a=await requireAdmin();if(!isAuthResult(a))return a;
 if(a.tenantId.toLowerCase()!==pilotTenant||process.env.CUT_CLUB_STAGING_MEMBERSHIP_BENEFIT_DRAFT_ENABLED!=='true')return reply({ok:false,code:'BENEFITS_NOT_RELEASED'},403);
 try{const pool=await getPool(),scope={tenantId:a.tenantId,staffId:a.userId};const [items,services]=await Promise.all([listBenefitDrafts(pool,scope),listBenefitCatalog(pool,scope)]);return reply({ok:true,draftOnly:true,benefitsEnabled:false,items,services});}catch(e){return failure(e);}
}
export async function POST(req:NextRequest){
 const origin=process.env.CUT_CLUB_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const a=await requireAdmin();if(!isAuthResult(a))return a;
 if(a.tenantId.toLowerCase()!==pilotTenant||process.env.CUT_CLUB_STAGING_MEMBERSHIP_BENEFIT_DRAFT_ENABLED!=='true')return reply({ok:false,code:'BENEFITS_NOT_RELEASED'},403);
 const raw=await req.text().catch(()=>null);if(!raw||raw.length>16384)return reply({ok:false,code:'INVALID_BENEFIT_DRAFT'},400);
 let input:unknown;try{input=JSON.parse(raw);}catch{return reply({ok:false,code:'INVALID_BENEFIT_DRAFT'},400);}
 try{return reply({ok:true,draftOnly:true,benefitsEnabled:false,item:await saveBenefitDraft(await getPool(),{tenantId:a.tenantId,staffId:a.userId},input)},201);}catch(e){return failure(e);}
}
