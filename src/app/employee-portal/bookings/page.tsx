import { redirect } from 'next/navigation';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { getMaskedTodayBookingsForEmployee, cairoTodayIso } from '@/lib/employee-portal/todayBookings';
import EnablePushNotifications from '@/components/employee-portal/EnablePushNotifications';
import TodayBookingsClient from './today-bookings-client';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكد',
  arrived: 'وصل',
  queued: 'في الطابور',
  in_service: 'جارٍ الخدمة',
  in_progress: 'جارٍ الخدمة',
  done: 'منتهي',
  completed: 'منتهي',
  cancelled: 'ملغي',
  no_show: 'لم يحضر',
  rescheduled: 'أُعيد جدولة',
};

export default async function EmployeePortalBookingsPage() {
  const identity = await getEmployeePortalIdentity();
  if (!identity) redirect('/employee-portal');
  if (identity.mustChangePassword) redirect('/employee-portal/change-password');

  const today = cairoTodayIso();
  const bookings = await getMaskedTodayBookingsForEmployee({
    empId: identity.empId,
    tenantId: identity.tenantId,
  });

  return (
    <main dir="rtl" className="h-full overflow-y-auto bg-zinc-950 text-white px-4 pb-8 pt-4 md:px-10 md:pt-7">
      <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
        <header className="relative overflow-hidden rounded-[28px] border border-amber-500/20 bg-gradient-to-bl from-[#282018] via-[#171719] to-[#0d0d11] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.25)] md:p-7">
          <div aria-hidden="true" className="pointer-events-none absolute -left-14 -top-20 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl" />
          <nav aria-label="التنقل في حساب الموظف" className="relative flex items-center justify-between gap-2 border-b border-white/10 pb-3">
            <a href="/employee-portal" className="flex min-w-0 items-center gap-2" aria-label="الصفحة الرئيسية لبوابة الموظفين">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-sm font-black text-amber-300">C</span>
              <span className="min-w-0">
                <span className="block text-xs font-black tracking-wider text-amber-300" dir="ltr">CUT STAFF</span>
                <span className="block text-[11px] text-zinc-400">حجوزات اليوم</span>
              </span>
            </a>
            <div className="flex items-center gap-1.5">
              <a
                href="/employee-portal/account-settings"
                className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-400"
              >
                الإعدادات
              </a>
              <form action="/employee-portal/logout" method="post">
                <button
                  type="submit"
                  className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 text-xs font-semibold text-zinc-300 hover:border-rose-400/40 hover:text-rose-200 focus-visible:outline-2 focus-visible:outline-amber-400"
                >
                  خروج
                </button>
              </form>
            </div>
          </nav>
          <div className="relative mt-4">
            <p className="text-[11px] font-bold text-amber-300/90">جدولك اليوم</p>
            <h1 className="mt-1 text-2xl font-extrabold leading-tight text-white md:text-3xl">حجوزاتك · {today}</h1>
            <p className="mt-1 text-xs text-zinc-400">الاسم الظاهر للعميل هو الاسم الأول فقط — بدون رقم أو بيانات كاملة</p>
          </div>
        </header>

        <EnablePushNotifications />

        <TodayBookingsClient
          initialBookings={bookings}
          statusLabels={STATUS_LABEL}
        />
      </div>
    </main>
  );
}
