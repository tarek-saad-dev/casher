import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {parseMembershipPreview,evaluateMembershipEligibility} from '@/lib/cut-club/membershipPolicy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
/** Hypothetical input only. Never creates a membership, modifies a customer or grants a discount. */
export async function POST(req:NextRequest){
  const origin=process.env.CUT_CLUB_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
  if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
  const staff=await requireAdmin();
  if(!isAuthResult(staff))return staff;
  const raw=await req.text().catch(()=>null);
  if(!raw||raw.length>8192)return reply({ok:false,code:'INVALID_PREVIEW'},400);
  let payload:unknown;
  try{payload=JSON.parse(raw);}catch{return reply({ok:false,code:'INVALID_PREVIEW'},400);}
  const parsed=parseMembershipPreview(payload);
  if(!parsed)return reply({ok:false,code:'INVALID_PREVIEW'},400);
  return reply({ok:true,previewOnly:true,...evaluateMembershipEligibility(parsed.policy,parsed.facts,new Date())});
}
