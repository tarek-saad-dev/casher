import {NextRequest,NextResponse} from 'next/server';
import {getPool} from '@/lib/db';
import {secureBffKey} from '@/lib/cut-club/memberOtp';
import {ApplicationError,listMemberApplications,submitMembershipApplication} from '@/lib/cut-club/membershipApplicationSql';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
const failure=(e:unknown)=>e instanceof ApplicationError?reply({ok:false,code:e.code},e.status):reply({ok:false,code:'APPLICATIONS_UNAVAILABLE'},503);
const check=(req:NextRequest)=>secureBffKey(req.headers.get('authorization'))&&!req.nextUrl.search;
export async function GET(req:NextRequest){
 if(!check(req))return reply({ok:false,code:'UNAUTHORIZED'},401);
 if(process.env.CUT_CLUB_STAGING_MEMBERSHIP_APPLICATION_ENABLED!=='true')return reply({ok:false,code:'APPLICATIONS_NOT_RELEASED'},403);
 try{return reply({ok:true,trialOnly:true,benefitsEnabled:false,items:await listMemberApplications(await getPool(),req.headers.get('x-cut-club-session'))});}catch(e){return failure(e);}
}
export async function POST(req:NextRequest){
 if(!check(req))return reply({ok:false,code:'UNAUTHORIZED'},401);
 if(process.env.CUT_CLUB_STAGING_MEMBERSHIP_APPLICATION_ENABLED!=='true')return reply({ok:false,code:'APPLICATIONS_NOT_RELEASED'},403);
 if(!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'INVALID_APPLICATION'},400);
 const raw=await req.text().catch(()=>null);if(!raw||raw.length>2048)return reply({ok:false,code:'INVALID_APPLICATION'},400);
 let input:unknown;try{input=JSON.parse(raw);}catch{return reply({ok:false,code:'INVALID_APPLICATION'},400);}
 try{return reply({ok:true,trialOnly:true,benefitsEnabled:false,...await submitMembershipApplication(await getPool(),req.headers.get('x-cut-club-session'),input)},201);}catch(e){return failure(e);}
}
