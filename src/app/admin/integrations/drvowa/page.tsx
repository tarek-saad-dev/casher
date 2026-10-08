import { redirect } from 'next/navigation';

import { DrvowaIntegrationCard } from '@/components/admin/DrvowaIntegrationCard';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';

export default async function DrvowaIntegrationPage() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) {
    redirect('/login');
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <p className="text-xs font-black text-sky-700">Integrations</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
          DRVOWA
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          اتصال ثنائي بين الـ ERP وموظف واتساب الذكي.
        </p>
      </div>

      <DrvowaIntegrationCard />
    </main>
  );
}
