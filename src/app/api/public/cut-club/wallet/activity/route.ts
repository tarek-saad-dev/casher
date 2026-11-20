import { NextRequest, NextResponse } from 'next/server';
import { secureBffKey, ClubAuthError } from '@/lib/cut-club/memberOtp';
import { loadCutClubActivity } from '@/lib/cut-club/memberWalletRead';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={ 'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex','X-Content-Type-Options':'nosniff' };
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers});

/** BFF-only: paginated coins history of the session owner. ?cursor=&limit=&type=all|earn|spend */
export async function GET(req:NextRequest){
  if(!secureBffKey(req.headers.get('authorization')))return reply({ok:false,code:'UNAUTHORIZED'},401);
  try{
    const q=req.nextUrl.searchParams;
    const page=await loadCutClubActivity(req.headers.get('x-cut-club-session'),{
      cursor:q.get('cursor'),limit:q.get('limit'),type:q.get('type'),
    });
    if(page==='INVALID')return reply({ok:false,code:'INVALID_REQUEST'},400);
    if(!page)return reply({ok:false,code:'SESSION_REQUIRED'},401);
    return reply({ok:true,...page});
  }catch(err){
    if(err instanceof ClubAuthError)return reply({ok:false,code:err.code},err.status);
    return reply({ok:false,code:'CUT_CLUB_UNAVAILABLE'},503);
  }
}
