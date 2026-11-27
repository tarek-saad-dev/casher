import Link from 'next/link';
import { signupOtpRequired } from '@/platform/publicSignup/otp';
import PublicSignupFlow from '@/components/public/PublicSignupFlow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ابدأ تجربتك | DRVOERP', description: 'ابدأ DRVOERP مجانًا لمدة 14 يوم بدون بطاقة بنكية.' };

export default function StartPage() {
  return <main dir="rtl" className="min-h-0 flex-1 overflow-y-auto bg-background px-3 pb-5 text-foreground sm:px-6">
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 py-5 sm:py-7">
      <Link href="/drvo" dir="ltr" className="text-2xl font-black tracking-tight sm:text-3xl">DRVO<span className="text-primary">ERP</span></Link>
      <Link href="/login" className="rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-bold shadow-sm transition-colors hover:border-primary sm:px-4">عندك حساب؟ تسجيل الدخول</Link>
    </header>
    <PublicSignupFlow otpRequired={signupOtpRequired()} />
  </main>;
}
