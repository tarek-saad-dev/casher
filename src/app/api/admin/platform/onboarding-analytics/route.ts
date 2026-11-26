import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/api-auth';
import { parseAnalyticsPeriod } from '@/platform/onboarding/analyticsModel';
import { loadOnboardingAnalytics } from '@/platform/onboarding/analyticsRepository';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){
  const auth=await requirePlatformOperator();
  if(auth instanceof NextResponse)return auth;
  let days;
  try{days=parseAnalyticsPeriod(new URL(req.url).searchParams.get('days'));}
  catch{return reply({error:'اختر 7 أو 30 أو 90 يوم.'},400);}
  try{return reply({ok:true,analytics:await loadOnboardingAnalytics(days)});}
  catch{return reply({error:'تعذر تحميل تحليلات التسجيل. حاول مرة تانية.'},503);}
}
