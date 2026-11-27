import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {getPool} from '@/lib/db';
import {pilotTenant} from '@/lib/cut-club/membershipDraft';
import {membershipTrialFromApplication,TrialError} from '@/lib/cut-club/membershipTrialSql';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
export async function POST(req:NextRequest){
 const origin=process.env.CUT_CLUB_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const staff=await requireAdmin();if(!isAuthResult(staff))return staff;
 if(staff.tenantId.toLowerCase()!==pilotTenant||process.env.CUT_CLUB_STAGING_MEMBERSHIP_TRIAL_ENABLED!=='true')return reply({ok:false,code:'TRIAL_NOT_RELEASED'},403);
 const raw=await req.text().catch(()=>null);if(!raw||raw.length>8192)return reply({ok:false,code:'INVALID_TRIAL'},400);
 let input:unknown;try{input=JSON.parse(raw);}catch{return reply({ok:false,code:'INVALID_TRIAL'},400);}
 try{return reply({ok:true,trialOnly:true,...await membershipTrialFromApplication(await getPool(),{tenantId:staff.tenantId,staffId:staff.userId},input)});}
 catch(e){return e instanceof TrialError?reply({ok:false,code:e.code},e.status):reply({ok:false,code:'TRIAL_UNAVAILABLE'},503);}
}
