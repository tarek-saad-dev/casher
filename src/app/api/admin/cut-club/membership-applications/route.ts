import {NextRequest,NextResponse} from 'next/server';
import {getPool} from '@/lib/db';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {ApplicationError,listAdminApplications,decideMembershipApplication} from '@/lib/cut-club/membershipApplicationSql';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
const failure=(e:unknown)=>e instanceof ApplicationError?reply({ok:false,code:e.code},e.status):reply({ok:false,code:'APPLICATIONS_UNAVAILABLE'},503);
export async function GET(){
 const a=await requireAdmin();if(!isAuthResult(a))return a;
 try{return reply({ok:true,trialOnly:true,...await listAdminApplications(await getPool(),{tenantId:a.tenantId,staffId:a.userId})});}catch(e){return failure(e);}
}
export async function POST(req:NextRequest){
 const origin=process.env.CUT_CLUB_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const a=await requireAdmin();if(!isAuthResult(a))return a;
 const raw=await req.text().catch(()=>null);if(!raw||raw.length>2048)return reply({ok:false,code:'INVALID_DECISION'},400);
 let input:unknown;try{input=JSON.parse(raw);}catch{return reply({ok:false,code:'INVALID_DECISION'},400);}
 try{return reply({ok:true,trialOnly:true,...await decideMembershipApplication(await getPool(),{tenantId:a.tenantId,staffId:a.userId},input)});}catch(e){return failure(e);}
}
