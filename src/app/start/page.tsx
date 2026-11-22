import Link from 'next/link';
import PublicSignupFlow from '@/components/public/PublicSignupFlow';
import { isPublicSignupEnabled } from '@/platform/publicSignup/launchGate';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'ابدأ تجربتك | DRVOERP',
  description: 'DRVO ERP — متابعة فتح التسجيل للمنشآت الجديدة.',
};

export default function StartPage() {
  const signupEnabled = isPublicSignupEnabled();
  return (
    <main className="min-h-[100dvh] overflow-y-auto bg-[#071018] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
      </div>
      <div className="relative mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-10 flex items-center justify-between">
          <Link href="/drvo" className="text-xl font-black tracking-tight">
            DRVO<span className="text-cyan-300">ERP</span>
          </Link>
          <Link href="/login" className="rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5">
            عندك حساب؟ دخول
          </Link>
        </header>
        {signupEnabled ? (
          <>
            <PublicSignupFlow />
            <p className="mx-auto mt-6 max-w-xl text-center text-[11px] leading-5 text-slate-500">
              بإنشاء الحساب أنت بتوافق على استخدام بيانات التسجيل لتجهيز مساحة العمل الخاصة ببيزنسك.
              مفيش دفع أو خصم خلال التجربة.
            </p>
          </>
        ) : (
          <section role="status" className="mx-auto max-w-xl rounded-2xl border border-cyan-300/20 bg-white/5 p-8 text-center">
            <h1 className="text-2xl font-bold text-white">التسجيل العام لسه غير متاح</h1>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              بنجهّز DRVO Salon لاستقبال صالونات جديدة بشكل آمن. مفيش حساب أو تجربة مجانية
              هتتفعّل من الصفحة دي قبل استكمال الاختبارات والمراجعات.
            </p>
            <Link href="/drvo" className="mt-6 inline-block rounded-lg border border-cyan-300/30 px-5 py-3 text-sm text-cyan-200 hover:bg-cyan-300/10">
              اعرف أكتر عن DRVO
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
