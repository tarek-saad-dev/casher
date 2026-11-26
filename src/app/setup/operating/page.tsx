import Link from 'next/link';
import OperatingSetup from '@/components/onboarding/OperatingSetup';
export const metadata = { title: 'إعدادات التشغيل | DRVO ERP' };
export default function OperatingPage() {
  return <main dir="rtl" className="min-h-0 flex-1 overflow-y-auto bg-[#eef2f5] text-[#102433]"><div className="mx-auto max-w-6xl px-4 py-5 sm:px-8"><header className="mb-5 flex items-center justify-between gap-2"><Link href="/setup" dir="ltr" className="text-xl font-black">DRVO<span className="text-[#087e7a]">ERP</span></Link><Link href="/setup/launch" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold">العودة للتشغيل</Link></header><OperatingSetup /></div></main>;
}
