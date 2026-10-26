import Link from 'next/link';
import {redirect} from 'next/navigation';
import {isAuthResult,requirePlatformOperator} from '@/lib/api-auth';
import InternalQuoteSnapshotsClient from '@/components/platform/InternalQuoteSnapshotsClient';

export const dynamic='force-dynamic';
export default async function InternalQuoteSnapshotsPage(){
 const auth=await requirePlatformOperator();
 if(!isAuthResult(auth))redirect('/403');
 return <div className="space-y-4">
  <Link className="text-sm text-muted-foreground hover:underline" href="/platform">
   العودة للمنشآت
  </Link>
  <InternalQuoteSnapshotsClient/>
 </div>;
}
