import Link from 'next/link';
import { signupOtpRequired } from '@/platform/publicSignup/otp';
import PublicSignupFlow from '@/components/public/PublicSignupFlow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ابدأ تجربتك | DRVOERP', description: 'ابدأ DRVOERP مجانًا لمدة 14 يوم بدون بطاقة بنكية.' };

export default function StartPage() {
  return <main dir="rtl" className="min-h-0 flex-1 overflow-y-auto bg-[#eef2f5] text-[#102433]">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
      <Link href="/drvo" dir="ltr" className="text-2xl font-black tracking-tight">DRVO<span className="text-[#087e7a]">ERP</span></Link>
      <Link href="/login" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold">عندك حساب؟ تسجيل الدخول</Link>
    </header>
    <PublicSignupFlow otpRequired={signupOtpRequired()} />
  </main>;
}
