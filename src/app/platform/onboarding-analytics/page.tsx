import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/api-auth';
import OnboardingAnalyticsPanel from '@/components/platform/OnboardingAnalyticsPanel';

export const dynamic='force-dynamic';
export default async function OnboardingAnalyticsPage(){
  const auth=await requirePlatformOperator();
  if(auth instanceof NextResponse)redirect(auth.status===401?'/login':'/403');
  return <OnboardingAnalyticsPanel/>;
}
