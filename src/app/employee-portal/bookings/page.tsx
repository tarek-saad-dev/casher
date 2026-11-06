import EmployeePortalShell from '@/components/employee-portal/EmployeePortalShell';
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
    <EmployeePortalShell>
        <header className="relative overflow-hidden rounded-[24px] border border-amber-500/20 bg-gradient-to-bl from-[#282018] via-[#171719] to-[#0d0d11] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.25)] md:p-7">
          <div aria-hidden="true" className="pointer-events-none absolute -left-14 -top-20 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="relative">
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
    </EmployeePortalShell>
  );
}
