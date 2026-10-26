import Link from 'next/link';
import {redirect} from 'next/navigation';
import {isAuthResult,requirePlatformOperator} from '@/lib/api-auth';
import CommercialPolicyEvidenceClient from '@/components/platform/CommercialPolicyEvidenceClient';

export const dynamic='force-dynamic';
export default async function CommercialEvidencePage({
 params,
}:{params:Promise<{candidateId:string}>}){
 const auth=await requirePlatformOperator();
 if(!isAuthResult(auth))redirect('/403');
 const {candidateId}=await params;
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(candidateId))
  redirect('/platform/commercial-release');
 return <div className="space-y-4">
  <Link href="/platform/commercial-release" className="text-sm text-muted-foreground underline">ملفات الإصدارات</Link>
  <CommercialPolicyEvidenceClient candidateId={candidateId} actorUserId={auth.userId}/>
 </div>;
}
