import { redirect } from 'next/navigation';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import EmployeePortalShell from '@/components/employee-portal/EmployeePortalShell';
import UsernameForm from './username-form';

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const identity = await getEmployeePortalIdentity();
  if (!identity) redirect('/employee-portal');
  if (identity.mustChangePassword) redirect('/employee-portal/change-password');
  if (!identity.loginName) redirect('/employee-portal');

  return (
    <EmployeePortalShell>
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="rounded-[24px] border border-amber-500/20 bg-gradient-to-bl from-[#282018] via-zinc-900 to-zinc-950 p-5 md:p-7">
          <p className="text-xs font-bold text-amber-300">حسابك الشخصي</p>
          <h1 className="mt-2 text-2xl font-extrabold">الإعدادات</h1>
          <p className="mt-2 text-sm text-zinc-400">تحكم في بيانات الدخول والأمان لحسابك في CUT STAFF</p>
        </header>
        <UsernameForm currentUsername={identity.loginName} />
        <section className="space-y-3 rounded-2xl border border-white/10 bg-zinc-900 p-5">
          <h2 className="text-lg font-bold">كلمة المرور</h2>
          <p className="text-sm leading-6 text-zinc-400">تقدر تغيّر كلمة المرور في أي وقت، بعد التأكد من كلمة المرور الحالية.</p>
          <a
            href="/employee-portal/change-password"
            className="inline-flex min-h-11 items-center rounded-xl border border-amber-400/25 bg-amber-400/10 px-5 py-3 text-sm font-bold text-amber-200 transition-colors hover:bg-amber-400/20 focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            تغيير كلمة المرور
          </a>
        </section>
      </div>
    </EmployeePortalShell>
  );
}
