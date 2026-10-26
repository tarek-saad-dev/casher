import Link from 'next/link';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { redirect } from 'next/navigation';
import ModularResearchClient from '@/components/platform/ModularResearchClient';

export const dynamic = 'force-dynamic';

export default async function ModularResearchPage() {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) redirect('/403');
  return (
    <main dir="rtl" className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <Link href="/platform" className="text-sm text-muted-foreground hover:underline">العودة لإدارة المنصة</Link>
      <ModularResearchClient />
    </main>
  );
}
