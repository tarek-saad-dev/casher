import Link from 'next/link';
import { CalendarPlus, ContactRound, Receipt, Settings2, Stethoscope } from 'lucide-react';
import ClinicAppointmentsPanel from './ClinicAppointmentsPanel';

export default function ClinicReceptionPage() {
  return (
    <main className="h-full overflow-y-auto bg-slate-50 p-4 text-slate-950 sm:p-6" dir="rtl">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-cyan-700">
              <Stethoscope className="h-4 w-4" /> DRVO Clinics
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-tight">استقبال العيادة</h1>
            <p className="mt-2 text-sm text-slate-500">
              الحجوزات والحضور وقائمة انتظار الأطباء، كلها في مكان واحد.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/bookings"
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white"
            ><CalendarPlus className="h-4 w-4" /> حجز جديد</Link>
            <Link
              href="/clinic/setup"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold"
            ><ContactRound className="h-4 w-4" /> المرضى والأطباء</Link>
          </div>
        </header>

        <ClinicAppointmentsPanel />

        <footer className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
          <Link href="/clinic/setup" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-cyan-700">
            <Settings2 className="h-4 w-4" /> إدارة الأطباء وملفات المرضى / زيارة بدون حجز
          </Link>
          <Link href="/income/pos" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-cyan-700">
            <Receipt className="h-4 w-4" /> الحسابات عبر Shared POS
          </Link>
        </footer>
      </div>
    </main>
  );
}
