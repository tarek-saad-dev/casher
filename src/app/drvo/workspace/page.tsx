import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function DrvoWorkspace() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const user = await getSession();
  if (!user) redirect('/login');
  return (
    <main dir="rtl" className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-7">
        <p className="text-sm font-semibold tracking-widest text-sky-400">DRVO ERP · STAGING</p>
        <h1 className="text-4xl font-bold">أهلاً بك في DRVO ERP</h1>
        <p className="text-slate-300">تم تسجيل الدخول بنجاح. إدارة النظام لا تتطلب فتح وردية POS.</p>
        <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold">مساحة العمل</h2>
          <p className="mt-3 text-slate-300">المرحلة التالية: الشركات والفروع والمستخدمون والصلاحيات والـ Modules.</p>
          <p className="mt-5 text-sm text-amber-300">بيئة تجريبية معزولة — عمليات POS والخدمات الخارجية غير مفعلة.</p>
        </section>
      </div>
    </main>
  );
}
