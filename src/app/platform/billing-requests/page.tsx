import Link from 'next/link';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { redirect } from 'next/navigation';
import OperatorPlanRequestQueue from '@/components/platform/OperatorPlanRequestQueue';

export const dynamic = 'force-dynamic';
export default async function PlatformBillingQueuePage() {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) redirect('/403');
  return <div className="space-y-4">
    <Link href="/platform" className="text-sm text-muted-foreground hover:underline">العودة للمنشآت</Link>
    <OperatorPlanRequestQueue />
  </div>;
}
