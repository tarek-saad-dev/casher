import Link from 'next/link';
import {redirect} from 'next/navigation';
import {isAuthResult,requirePlatformOperator} from '@/lib/api-auth';
import OperatorModularInquiryQueue from '@/components/platform/OperatorModularInquiryQueue';

export const dynamic='force-dynamic';
export default async function ModularQuoteInquiriesPage(){
  const auth=await requirePlatformOperator();
  if(!isAuthResult(auth))redirect('/403');
  return <div className="space-y-4">
    <Link href="/platform" className="text-sm text-muted-foreground hover:underline">العودة للمنشآت</Link>
    <OperatorModularInquiryQueue />
  </div>;
}
