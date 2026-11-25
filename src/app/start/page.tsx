import Link from 'next/link';
import { CalendarDays, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import PublicSignupFlow from '@/components/public/PublicSignupFlow';

export const metadata = {
  title: 'ابدأ تجربتك | DRVOERP',
  description: 'ابدأ DRVOERP مجانًا لمدة 14 يوم بدون بطاقة بنكية.',
};

export default function StartPage() {
  return (
    <main dir="rtl" className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-[#071018] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
      </div>
      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-5 sm:px-8">
        <header className="mb-7 flex items-center justify-between border-b border-white/10 pb-5">
          <Link href="/drvo" dir="ltr" className="text-xl font-black tracking-tight">DRVO<span className="text-cyan-300">ERP</span></Link>
          <Link href="/login" className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-bold text-slate-200 hover:bg-white/5">عندك حساب؟ دخول</Link>
        </header>
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)] lg:gap-12">
          <aside className="min-w-0 lg:sticky lg:top-6 lg:py-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold text-cyan-200"><Sparkles className="h-4 w-4" /> ابدأ تجربتك المجانية</div>
            <h1 className="mt-4 text-3xl font-black leading-tight sm:text-5xl">بيزنسك.<br className="hidden lg:block" /> <span className="text-cyan-300">مساحة عمل واحدة.</span></h1>
            <p className="mt-4 max-w-sm text-sm leading-7 text-slate-300">من أول تسجيل الحساب لحد تجهيز الخدمات والفريق والتشغيل. اختار اللي يناسب نشاطك وابدأ بخطوات واضحة.</p>
            <div className="mt-5 grid gap-3 lg:mt-9">
              {[{ icon: CalendarDays, title: '14 يوم تجربة', desc: 'من غير بطاقة بنكية' }, { icon: ShieldCheck, title: 'حساب مستقل', desc: 'بيانات وإعدادات منشأتك' }, { icon: CheckCircle2, title: 'تجهيز خطوة بخطوة', desc: 'كمّل إعداد نشاطك من داخل النظام' }].map(item => <div key={item.title} className="flex items-center gap-3"><item.icon className="h-5 w-5 shrink-0 text-cyan-300" /><div><p className="text-sm font-bold">{item.title}</p><p className="hidden text-xs text-slate-400 lg:block">{item.desc}</p></div></div>)}
            </div>
          </aside>
          <section className="min-w-0">
            <PublicSignupFlow />
            <p className="mx-auto mt-5 max-w-xl text-center text-xs leading-6 text-slate-400">بنستخدم بيانات التسجيل لتجهيز حساب نشاطك. مفيش دفع أو خصم خلال التجربة.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
