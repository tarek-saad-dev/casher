import {NextRequest,NextResponse} from 'next/server';
import {secureBffKey,ClubAuthError} from '@/lib/cut-club/memberOtp';
import {loadMemberRewardCatalog} from '@/lib/cut-club/memberRewardsRead';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex','X-Content-Type-Options':'nosniff'};
const respond=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});

/** Read-only BFF store: no clientId, no public CORS, never a Coins mutation. */
export async function GET(req:NextRequest){
  if(!secureBffKey(req.headers.get('authorization')))
    return respond({ok:false,code:'UNAUTHORIZED'},401);
  try{
    const items=await loadMemberRewardCatalog(req.headers.get('x-cut-club-session'));
    if(!items)return respond({ok:false,code:'SESSION_REQUIRED'},401);
    return respond({ok:true,...items});
  }catch(err){
    if(err instanceof ClubAuthError)return respond({ok:false,code:err.code},err.status);
    return respond({ok:false,code:'CUT_CLUB_UNAVAILABLE'},503);
  }
}
/** Disable writes explicitly until settlement and POS claim share an approved atomic release. */
export async function POST(){return respond({ok:false,code:'REWARD_PURCHASE_NOT_RELEASED'},403);}
export async function OPTIONS(){return respond({ok:false,code:'REWARD_PURCHASE_NOT_RELEASED'},403);}
