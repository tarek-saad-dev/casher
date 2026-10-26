import Link from 'next/link';
import { ArrowRight, Stethoscope } from 'lucide-react';
import ClinicServiceSettings from '../ClinicServiceSettings';

export const metadata = {
  title: 'إعدادات خدمات العيادة | DRVO Clinics',
  description: 'تسعير خدمات العيادة وجدول الأطباء من الموديولات المشتركة.',
};

export default function ClinicServiceSettingsPage() {
  return (
    <main className="h-full overflow-y-auto bg-slate-50 p-4 text-slate-950 sm:p-6" dir="rtl">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <Link href="/clinic" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-cyan-700">
            <ArrowRight className="h-4 w-4" /> الاستقبال
          </Link>
          <div className="mt-3 flex items-center gap-2 text-sm font-bold text-cyan-700">
            <Stethoscope className="h-4 w-4" /> DRVO Clinics
          </div>
          <h1 className="mt-2 text-3xl font-black">إعدادات خدمات العيادة</h1>
          <p className="mt-2 text-sm text-slate-500">
            أسعار الخدمات من الكتالوج المشترك، وجداول الأطباء من Workforce.
          </p>
        </header>
        <ClinicServiceSettings />
      </div>
    </main>
  );
}
