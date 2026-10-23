import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import AttendancePanel from '@/components/hr/AttendancePanel';

export const dynamic = 'force-dynamic';

export default async function ManagerPage() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) redirect('/login');
  return (
    <div dir="rtl" className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <header>
        <p className="text-sm text-amber-400">CUT SALON · واجهة المدير</p>
        <h1 className="mt-2 text-2xl font-bold">مراجعة اليوم</h1>
        <p className="mt-2 text-sm text-zinc-400">راجع الحضور والانصراف، احفظ التصحيحات، ثم اقفل اليوم.</p>
      </header>
      <Suspense fallback={<p role="status">جاري تحميل الحضور...</p>}>
        <AttendancePanel managerWorkspace />
      </Suspense>
    </div>
  );
}
