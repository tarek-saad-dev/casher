import Link from 'next/link';
import PublicSignupFlow from '@/components/public/PublicSignupFlow';

export const metadata = {
  title: 'ابدأ تجربتك | DRVOERP',
  description: 'ابدأ DRVOERP مجانًا لمدة 14 يوم بدون بطاقة بنكية.',
};

export default function StartPage() {
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
        <PublicSignupFlow />
        <p className="mx-auto mt-6 max-w-xl text-center text-[11px] leading-5 text-slate-500">
          بإنشاء الحساب أنت بتوافق على استخدام بيانات التسجيل لتجهيز مساحة العمل الخاصة ببيزنسك.
          مفيش دفع أو خصم خلال التجربة.
        </p>
      </div>
    </main>
  );
}
