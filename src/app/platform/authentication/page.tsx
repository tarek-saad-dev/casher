import { redirect } from 'next/navigation';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import PlatformOtpPanel from '@/components/platform/PlatformOtpPanel';

export const dynamic = 'force-dynamic';
export default async function AuthenticationPage() {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) redirect(auth.status === 401 ? '/login' : '/403');
  return <PlatformOtpPanel />;
}
