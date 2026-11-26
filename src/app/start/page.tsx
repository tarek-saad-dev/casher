import Link from 'next/link';
import { signupOtpRequired } from '@/platform/publicSignup/otp';
import PublicSignupFlow from '@/components/public/PublicSignupFlow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ابدأ تجربتك | DRVOERP', description: 'ابدأ DRVOERP مجانًا لمدة 14 يوم بدون بطاقة بنكية.' };

export default function StartPage() {
  return <main dir="rtl" className="min-h-0 flex-1 overflow-y-auto bg-[#eef2f5] text-[#102433]">
    <div className="mx-auto flex min-h-full w-full max-w-[1520px] flex-col px-3 pb-4 sm:px-6 sm:pb-6 lg:px-8 lg:pb-8 2xl:px-10">
    <header className="flex shrink-0 items-center justify-between gap-3 py-4 lg:py-5">
      <Link href="/drvo" dir="ltr" className="text-2xl font-black tracking-tight">DRVO<span className="text-[#087e7a]">ERP</span></Link>
      <Link href="/login" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold">عندك حساب؟ تسجيل الدخول</Link>
    </header>
    <PublicSignupFlow otpRequired={signupOtpRequired()} />
    </div>
  </main>;
}
