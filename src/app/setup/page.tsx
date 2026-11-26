import Link from 'next/link';
import SelfServiceSetup from '@/components/onboarding/SelfServiceSetup';

export const metadata = { title: 'أهلاً بيك في DRVO | تجهيز بيزنسك' };

export default function WelcomeSetupPage() {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><div dir="rtl" className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 text-xs text-[#102433]"><span className="font-bold">جرب النظام بدون بيانات حقيقية</span><Link href="/setup/training" className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 font-bold text-teal-800">مساحة التدريب</Link></div><SelfServiceSetup currentStep="welcome" /></div>;
}
