import {NextRequest,NextResponse} from 'next/server';
import {getPool} from '@/lib/db';
import {secureBffKey} from '@/lib/cut-club/memberOtp';
import {readPublishedMemberships,PublicationError} from '@/lib/cut-club/membershipPublicationSql';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
export async function GET(req:NextRequest){
 if(!secureBffKey(req.headers.get('authorization')))return reply({ok:false,code:'UNAUTHORIZED'},401);
 if(process.env.CUT_CLUB_STAGING_MEMBERSHIP_PUBLICATION_ENABLED!=='true')return reply({ok:false,code:'PUBLICATION_NOT_RELEASED'},403);
 if(req.nextUrl.search)return reply({ok:false,code:'INVALID_REQUEST'},400);
 try{return reply({ok:true,trialOnly:true,enrollmentEnabled:false,benefitsEnabled:false,items:await readPublishedMemberships(await getPool())});}
 catch(e){return e instanceof PublicationError?reply({ok:false,code:e.code},e.status):reply({ok:false,code:'PUBLICATION_UNAVAILABLE'},503);}
}
