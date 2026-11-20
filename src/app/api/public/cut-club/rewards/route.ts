import { NextRequest, NextResponse } from 'next/server';
import { secureBffKey } from '@/lib/cut-club/memberOtp';
import { loadRewardCatalog } from '@/lib/cut-club/memberRewards';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={ 'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex','X-Content-Type-Options':'nosniff' };
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers});

/** BFF-only: live reward catalog; member balance included when a linked session is sent. */
export async function GET(req:NextRequest){
  if(!secureBffKey(req.headers.get('authorization')))return reply({ok:false,code:'UNAUTHORIZED'},401);
  try{
    return reply({ok:true,...await loadRewardCatalog(req.headers.get('x-cut-club-session'))});
  }catch{return reply({ok:false,code:'CUT_CLUB_UNAVAILABLE'},503);}
}
