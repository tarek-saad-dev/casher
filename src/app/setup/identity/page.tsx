import Link from 'next/link';
import OnboardingIdentityForm from '@/components/onboarding/OnboardingIdentityForm';

export const metadata = { title: 'هوية المنشأة | DRVO ERP' };
export default function IdentityPage() {
  return <main dir="rtl" className="min-h-0 flex-1 overflow-y-auto bg-[#eef2f5] text-[#102433]">
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-8">
      <header className="mb-5 flex items-center justify-between gap-2">
        <Link href="/setup" dir="ltr" className="text-xl font-black">DRVO<span className="text-[#087e7a]">ERP</span></Link>
        <Link href="/setup/branch" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold">العودة لتجهيز الفرع</Link>
      </header>
      <OnboardingIdentityForm />
    </div>
  </main>;
}
