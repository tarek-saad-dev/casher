import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {getPool} from '@/lib/db';
import {pilotTenant,parseMembershipDraft} from '@/lib/cut-club/membershipDraft';
import {DraftError,listMembershipDrafts,saveMembershipDraft} from '@/lib/cut-club/membershipDraftSql';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
const error=(e:unknown)=>e instanceof DraftError?reply({ok:false,code:e.code},e.status):reply({ok:false,code:'DRAFT_UNAVAILABLE'},503);
export async function GET(){
 const staff=await requireAdmin();if(!isAuthResult(staff))return staff;
 if(staff.tenantId.toLowerCase()!==pilotTenant||process.env.CUT_CLUB_STAGING_MEMBERSHIP_DRAFT_ENABLED!=='true')return reply({ok:false,code:'DRAFT_NOT_RELEASED'},403);
 try{return reply({ok:true,draftOnly:true,items:await listMembershipDrafts(await getPool(),{tenantId:staff.tenantId,staffId:staff.userId})});}catch(e){return error(e);}
}
export async function POST(req:NextRequest){
 const origin=process.env.CUT_CLUB_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const staff=await requireAdmin();if(!isAuthResult(staff))return staff;
 if(staff.tenantId.toLowerCase()!==pilotTenant||process.env.CUT_CLUB_STAGING_MEMBERSHIP_DRAFT_ENABLED!=='true')return reply({ok:false,code:'DRAFT_NOT_RELEASED'},403);
 const raw=await req.text().catch(()=>null);if(!raw||raw.length>8192)return reply({ok:false,code:'INVALID_DRAFT'},400);
 let value:unknown;try{value=JSON.parse(raw);}catch{return reply({ok:false,code:'INVALID_DRAFT'},400);}
 const input=parseMembershipDraft(value);if(!input)return reply({ok:false,code:'INVALID_DRAFT'},400);
 try{return reply({ok:true,draftOnly:true,item:await saveMembershipDraft(await getPool(),{tenantId:staff.tenantId,staffId:staff.userId},input)},201);}catch(e){return error(e);}
}
