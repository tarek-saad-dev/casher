import { redirect } from 'next/navigation';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { getTenantInstalledAppsForGate } from '@/platform/commercial/tenantAccessGate';
import TrainingExperience from '@/components/onboarding/TrainingExperience';

export const metadata = { title: 'مساحة التدريب | DRVO ERP' };
export const dynamic = 'force-dynamic';
export default async function TrainingPage() {
  const auth=await requireAdmin();
  if(!isAuthResult(auth))redirect(auth.status===401?'/login':'/403');
  const apps=await getTenantInstalledAppsForGate(auth.tenantId);
  return <TrainingExperience apps={apps.filter(a=>['pos','booking','queue','treasury'].includes(a))}/>;
}
