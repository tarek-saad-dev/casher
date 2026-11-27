import { createHash,timingSafeEqual } from 'node:crypto';
import { NextRequest,NextResponse } from 'next/server';
import { DecemberRegistrationError,registerDecemberParticipant } from '@/lib/campaigns/december-exam/registrationRepository';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
const digest=(v:string)=>createHash('sha256').update(v).digest();
export async function POST(req:NextRequest){
  // Internal integration gate only. Public rollout requires rate limiting and staff recovery.
  if(process.env.DECEMBER_EXAM_INTERNAL_REGISTRATION_ENABLED!=='true')return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
  const key=process.env.DECEMBER_EXAM_BFF_SHARED_KEY,tenant=process.env.DECEMBER_EXAM_TENANT_ID;
  const authorization=req.headers.get('authorization');
  if(!key||Buffer.byteLength(key)<32||!tenant||!authorization?.startsWith('Bearer ')||
    !timingSafeEqual(digest(key),digest(authorization.slice(7))))return reply({ok:false,code:'UNAUTHORIZED'},401);
  if(!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'INVALID_REQUEST'},400);
  const length=Number(req.headers.get('content-length'));
  if(!Number.isSafeInteger(length)||length<=0||length>8192)return reply({ok:false,code:'INVALID_REQUEST'},400);
  try{
    const raw=await req.text();
    if(Buffer.byteLength(raw)>8192)return reply({ok:false,code:'INVALID_REQUEST'},400);
    let input:unknown;
    try{input=JSON.parse(raw);}catch{return reply({ok:false,code:'INVALID_REQUEST'},400);}
    const result=await registerDecemberParticipant(tenant,input);
    return reply(result,201);
  }catch(e){
    if(e instanceof DecemberRegistrationError)return reply({ok:false,code:e.code},e.status);
    return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
  }
}
