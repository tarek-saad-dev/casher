import {NextRequest,NextResponse} from 'next/server';
import {getPool} from '@/lib/db';
import {secureBffKey} from '@/lib/cut-club/memberOtp';
import {readMembershipTrials,MembershipReadError} from '@/lib/cut-club/memberMembershipRead';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex'}});
export async function GET(req:NextRequest){
 if(!secureBffKey(req.headers.get('authorization')))return reply({ok:false,code:'UNAUTHORIZED'},401);
 if(process.env.CUT_CLUB_STAGING_MEMBERSHIP_MEMBER_READ_ENABLED!=='true')return reply({ok:false,code:'MEMBERSHIPS_NOT_RELEASED'},403);
 if(req.nextUrl.search)return reply({ok:false,code:'INVALID_REQUEST'},400);
 try{return reply(await readMembershipTrials(await getPool(),req.headers.get('x-cut-club-session')));}
 catch(e){return e instanceof MembershipReadError?reply({ok:false,code:e.code},e.status):reply({ok:false,code:'MEMBERSHIPS_UNAVAILABLE'},503);}
}
export async function POST(){return reply({ok:false,code:'ENROLLMENT_NOT_RELEASED'},403);}
