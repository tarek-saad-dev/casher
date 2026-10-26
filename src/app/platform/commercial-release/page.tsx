import Link from 'next/link';
import {redirect} from 'next/navigation';
import {isAuthResult,requirePlatformOperator} from '@/lib/api-auth';
import CommercialReleaseCandidatesClient from '@/components/platform/CommercialReleaseCandidatesClient';

export const dynamic='force-dynamic';
export default async function CommercialReleasePage(){
  const auth=await requirePlatformOperator();
  if(!isAuthResult(auth))redirect('/403');
  return <div className="space-y-4">
    <Link href="/platform" className="text-sm text-muted-foreground hover:underline">العودة للمنشآت</Link>
    <CommercialReleaseCandidatesClient/>
  </div>;
}
