import Link from 'next/link';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  Layers3,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

export const metadata = {
  title: 'DRVOERP — بيزنسك كله في مكان واحد',
  description: 'حجوزات، كاشير، موظفين، رواتب، خزنة وتقارير في نظام تشغيل واحد.',
};

const FEATURES = [
  { title: 'الحجوزات', text: 'مواعيد، أقرب موظف، وإدارة يومك من شاشة واحدة.', icon: CalendarDays },
  { title: 'الكاشير والمبيعات', text: 'فاتورة سريعة، طرق دفع، وخزنة مرتبطة بالتشغيل.', icon: ReceiptText },
  { title: 'الفريق', text: 'حضور، جداول، فروع، وصلاحيات لكل حد في مكانه.', icon: Users },
  { title: 'الرواتب', text: 'مرتب، يومية، عمولة وسلف مرتبطة بالشغل الفعلي.', icon: CircleDollarSign },
  { title: 'التقارير', text: 'اعرف الفلوس جاية منين وإيه اللي محتاج قرار.', icon: BarChart3 },
  { title: 'التشغيل', text: 'يوم تشغيل، ورديات، ومتابعة جاهزية الفرع خطوة بخطوة.', icon: Clock3 },
];

const STEPS = [
  { name: 'اختار نشاطك', detail: 'ابدأ بالصالون، واستخدم التطبيقات المناسبة لشغلك.' },
  { name: 'اختار تطبيقاتك', detail: 'حجوزات، كاشير، دور، رواتب وغيرها حسب احتياجك.' },
  { name: 'اتحكم في التكلفة', detail: 'التسعير حسب التطبيقات والتوسع. الأسعار النهائية قيد الإعداد وهتكون واضحة قبل أي دفع.' },
];

export default function DrvoLandingPage() {
  return (
    <main className="min-h-[100dvh] overflow-y-auto bg-[#061019] text-white selection:bg-cyan-300 selection:text-slate-950">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute left-1/3 top-1/2 h-[26rem] w-[26rem] rounded-full bg-blue-500/10 blur-3xl" />
      </div>

      <div className="relative">
        <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <div className="text-xl font-black tracking-tight">
            DRVO<span className="text-cyan-300">ERP</span>
          </div>
          <nav className="hidden items-center gap-6 text-xs text-slate-400 md:flex">
            <a href="#system" className="hover:text-white">النظام</a>
            <a href="#pricing" className="hover:text-white">الأسعار</a>
            <Link href="/login" className="hover:text-white">دخول</Link>
          </nav>
          <Link
            href="/start"
            className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-4 py-2 text-xs font-black text-slate-950"
          >
            ابدأ إنشاء شركتك
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </header>

        <section className="mx-auto grid min-h-[78vh] max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:px-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1.5 text-xs text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />
              نظام تشغيل للبيزنس — مش مجرد كاشير
            </div>
            <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[1.05] sm:text-6xl lg:text-7xl">
              صالونك كله.
              <br />
              <span className="text-cyan-300">تحت سيطرتك.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
              من أول حجز العميل، لحد آخر جنيه في يومك.
              DRVO بيجمع التشغيل، الفريق، المبيعات والتقارير في مكان واحد.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/start"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-slate-950"
              >
                ابدأ إنشاء شركتك
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <a
                href="#system"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-6 py-3 text-sm font-bold text-slate-200 hover:bg-white/5"
              >
                شوف النظام
              </a>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-cyan-300" /> بدون بطاقة بنكية</span>
              <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-cyan-300" /> تجهيز في دقائق</span>
              <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-cyan-300" /> بياناتك منفصلة وآمنة</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl">
            <div className="absolute inset-8 rounded-[3rem] bg-cyan-300/10 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2.2rem] border border-white/10 bg-white/[0.055] p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <div>
                  <div className="text-xs text-slate-500">اليوم</div>
                  <div className="mt-1 font-bold">فرع سموحة</div>
                </div>
                <div className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">شغال</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                  <div className="text-xs text-slate-500">المبيعات</div>
                  <div className="mt-2 text-2xl font-black">8,420 <span className="text-xs font-normal text-slate-500">ج.م</span></div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                  <div className="text-xs text-slate-500">الحجوزات</div>
                  <div className="mt-2 text-2xl font-black">18</div>
                </div>
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-4">
                <div className="mb-4 flex items-center justify-between text-xs">
                  <span className="text-slate-400">التشغيل اليومي</span>
                  <span className="text-cyan-300">كل حاجة متصلة</span>
                </div>
                <div className="space-y-3">
                  {[
                    ['11:00', 'أحمد — Hair Cut', '200 ج.م'],
                    ['12:15', 'كريم — Hair & Beard', '280 ج.م'],
                    ['13:30', 'يوسف — Skin Care', '300 ج.م'],
                  ].map((row) => (
                    <div key={row[0] + row[1]} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 rounded-xl bg-white/[0.035] px-3 py-2.5 text-xs">
                      <span className="font-mono text-slate-500">{row[0]}</span>
                      <span className="font-medium">{row[1]}</span>
                      <span className="text-slate-400">{row[2]}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                {['Booking', 'POS', 'Payroll'].map((x) => (
                  <div key={x} className="rounded-xl border border-cyan-300/10 bg-cyan-300/5 px-2 py-2 text-cyan-100">
                    {x}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="system" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">CONNECTED SYSTEM</p>
            <h2 className="mt-3 text-4xl font-black sm:text-5xl">كل جزء عارف الجزء اللي بعده.</h2>
            <p className="mt-4 leading-8 text-slate-400">
              الحجز يدخل التشغيل. التشغيل يدخل الفاتورة. الفاتورة تحدث الخزنة والتقارير.
              شغل أقل يدوي، وصورة أوضح لصاحب البيزنس.
            </p>
          </div>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 font-bold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-400">{item.text}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-5 rounded-[2.4rem] border border-white/10 bg-gradient-to-l from-cyan-300/10 to-blue-500/5 p-6 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-bold text-cyan-300">
                <Layers3 className="h-4 w-4" />
                من أول تسجيلك
              </div>
              <h2 className="mt-3 text-3xl font-black sm:text-4xl">مش هنسيبك قدام Dashboard فاضية.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                اختار نشاطك واحتياجاتك، وDRVO يجهز الـWorkspace، الفرع، التطبيقات والخطة.
                ولو صالون تقدر تبدأ ببيانات Demo وتشوف النظام شغال من أول دخول.
              </p>
            </div>
            <Link
              href="/start"
              className="inline-flex w-fit items-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-black text-slate-950"
            >
              جهز حسابك
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">APPS THAT FIT YOUR BUSINESS</p>
            <h2 className="mt-3 text-4xl font-black">اختار اللي محتاجه بس</h2>
            <p className="mt-3 text-sm text-slate-400">14 يوم تجربة مجانية — بدون بطاقة بنكية. الأسعار النهائية حسب التطبيقات قيد الإعداد، ومفيش تحصيل قبل عرض التكلفة بوضوح.</p>
          </div>
          <div className="mx-auto mt-10 grid max-w-5xl gap-3 md:grid-cols-3">
            {STEPS.map((step) => (
              <article key={step.name} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <h3 className="text-lg font-bold">{step.name}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-400">{step.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-24 text-center sm:px-6">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-cyan-300 text-slate-950">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h2 className="mt-5 text-4xl font-black">جاهز تشوف بيزنسك أوضح؟</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-400">
            أقل من 5 دقايق وتكون داخل DRVO بحساب مستقل وتجربة شغالة.
          </p>
          <Link
            href="/start"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-black text-slate-950"
          >
            ابدأ تجربتك
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </section>

        <footer className="border-t border-white/10 px-4 py-8 text-center text-xs text-slate-600">
          DRVOERP — Business Operating System
        </footer>
      </div>
    </main>
  );
}
