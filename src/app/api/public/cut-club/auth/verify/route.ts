import { NextRequest, NextResponse } from 'next/server';
import { secureBffKey, ClubAuthError } from '@/lib/cut-club/memberOtp';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={ 'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex','X-Content-Type-Options':'nosniff' };
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers});
function failure(err:unknown) {
  if(err instanceof ClubAuthError)return reply({ok:false,code:err.code},err.status);
  const code=err instanceof Error ? err.message : '';
  if(code==='INVALID_OTP'||code==='INVALID_PHONE')return reply({ok:false,code:'INVALID_OTP'},400);
  if(code==='OTP_EXPIRED')return reply({ok:false,code:'OTP_EXPIRED'},410);
  if(code==='RATE_LIMITED'||code==='OTP_RATE_LIMITED')return reply({ok:false,code:'RATE_LIMITED'},429);
  if(code==='WHATSAPP_NOT_READY'||code==='OTP_NOT_READY')return reply({ok:false,code:'WHATSAPP_NOT_READY'},409);
  if(code==='OTP_DELIVERY_FAILED')return reply({ok:false,code:'OTP_DELIVERY_FAILED'},503);
  return reply({ok:false,code:'CUT_CLUB_UNAVAILABLE'},503);
}
function trusted(req:NextRequest) {return secureBffKey(req.headers.get('authorization'));}
import { verifyCutClubOtp } from '@/lib/cut-club/memberOtp';

export async function POST(req:NextRequest) {
 if(!trusted(req))return reply({ok:false,code:'UNAUTHORIZED'},401);
 try {
   const data=await req.json();
   if(!data || typeof data!=='object')return reply({ok:false,code:'INVALID_REQUEST'},400);
   const verified=await verifyCutClubOtp(data.pendingToken,data.code);
   return reply({ok:true,...verified});
 } catch(err) {return failure(err);}
}
