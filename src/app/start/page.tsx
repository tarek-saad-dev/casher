import Link from 'next/link';
import { signupOtpRequired } from '@/platform/publicSignup/otp';
import PublicSignupFlow from '@/components/public/PublicSignupFlow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ابدأ تجربتك | DRVOERP', description: 'ابدأ DRVOERP مجانًا لمدة 14 يوم بدون بطاقة بنكية.' };

export default function StartPage() {
  return <main dir="rtl" className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-[#edf5f4] via-[#f5f7fa] to-[#eef2f5] px-3 pb-5 text-[#102433] sm:px-6">
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 py-5 sm:py-7">
      <Link href="/drvo" dir="ltr" className="text-2xl font-black tracking-tight sm:text-3xl">DRVO<span className="text-[#087e7a]">ERP</span></Link>
      <Link href="/login" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold shadow-sm transition-colors hover:border-teal-400 sm:px-4">عندك حساب؟ تسجيل الدخول</Link>
    </header>
    <PublicSignupFlow otpRequired={signupOtpRequired()} />
  </main>;
}
