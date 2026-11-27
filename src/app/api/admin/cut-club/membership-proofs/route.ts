import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {getPool} from '@/lib/db';
import {normalizeCutClubPhone} from '@/lib/cut-club/memberOtp';
import {pilotTenant} from '@/lib/cut-club/membershipDraft';
import {ProofError,lookupMembershipProof,recordMembershipProof} from '@/lib/cut-club/membershipProofSql';
export const runtime='nodejs';export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
/** POST lookup keeps phone numbers out of URLs. POST commands are staff-only and never grant benefits. */
export async function POST(req:NextRequest){
 const origin=process.env.CUT_CLUB_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const staff=await requireAdmin();if(!isAuthResult(staff))return staff;
 if(staff.tenantId.toLowerCase()!==pilotTenant||process.env.CUT_CLUB_STAGING_MEMBERSHIP_PROOF_ENABLED!=='true')return reply({ok:false,code:'PROOF_NOT_RELEASED'},403);
 const raw=await req.text().catch(()=>null);if(!raw||raw.length>8192)return reply({ok:false,code:'INVALID_PROOF'},400);
 let input:unknown;try{input=JSON.parse(raw);}catch{return reply({ok:false,code:'INVALID_PROOF'},400);}
 const scope={tenantId:staff.tenantId,staffId:staff.userId};
 try{
 if(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).sort().join(',')==='action,phone'&&(input as any).action==='LOOKUP'){
 const phone=normalizeCutClubPhone((input as any).phone);if(!phone)return reply({ok:false,code:'INVALID_PHONE'},400);
 return reply({ok:true,evidenceOnly:true,account:await lookupMembershipProof(await getPool(),scope,phone)});
 }
 return reply({ok:true,evidenceOnly:true,...await recordMembershipProof(await getPool(),scope,input)},201);
 }catch(e){return e instanceof ProofError?reply({ok:false,code:e.code},e.status):reply({ok:false,code:'PROOF_UNAVAILABLE'},503);}
}
