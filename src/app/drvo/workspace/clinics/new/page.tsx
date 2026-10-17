import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getPool } from '@/lib/db';
import { loadPlatformPrincipal } from '@/platform/modules/platformAuthorityRepository';
import ClinicOnboardingForm from './ClinicOnboardingForm';

export const dynamic = 'force-dynamic';

export default async function NewClinicPage() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const session = await getSession();
  if (!session) redirect('/login');

  let canCreate = false;
  try {
    const db = await getPool();
    const principal = await loadPlatformPrincipal(session.UserID, { executor: db });
    canCreate = principal.active && principal.userId === session.UserID &&
      principal.grants.includes('platform.entitlements.manage');
  } catch {
    canCreate = false;
  }

  return (
    <main dir="rtl" className="min-h-screen bg-[#080e1a] px-5 py-9 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-7">
        <Link href="/drvo/workspace" className="text-sm text-cyan-300">← مساحة العمل</Link>
        <header className="rounded-3xl border border-cyan-400/20 bg-gradient-to-l from-[#12324a] to-[#101a2c] p-7 sm:p-10">
          <p className="text-xs font-bold tracking-widest text-cyan-300">DRVO ERP / CLINICS</p>
          <h1 className="mt-4 text-3xl font-black">إضافة عيادة جديدة</h1>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            أنشئ شركة عيادة مستقلة، وفرعها الأول، وحساب المالك في خطوة واحدة باستخدام Clinic Industry Pack.
            لن يتم نقل أي بيانات من CUT Salon أو منح صلاحيات طبية تلقائيًا.
          </p>
        </header>
        {canCreate ? <ClinicOnboardingForm /> : (
          <section className="rounded-2xl border border-amber-400/20 bg-[#101a2c] p-7">
            <h2 className="font-bold text-amber-200">تحتاج صلاحية مسؤول المنصة</h2>
            <p className="mt-3 text-sm text-slate-300">إنشاء عيادة جديدة متاح فقط لحساب Platform Operator المصرح له بإدارة الاشتراكات. سجّل الدخول بحساب الإدارة المخصص.</p>
          </section>
        )}
        <p className="text-xs leading-6 text-slate-500">هذه نسخة Staging للتجربة الإدارية فقط. لا تُدخل بيانات مرضى حقيقية أو ملفات طبية أو معلومات صحية حساسة قبل اكتمال ضوابط الحماية.</p>
      </div>
    </main>
  );
}
