import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Activity, ArrowUpLeft, Bell, Blocks, Building2,
  CalendarDays, ChartNoAxesCombined, ChevronLeft,
  CreditCard, GitBranch, LayoutDashboard, LockKeyhole, Menu,
  Settings2, ShieldCheck, Users, Wallet,
} from 'lucide-react';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const navigation = [
  { label: 'نظرة عامة', icon: LayoutDashboard, active: true },
  { label: 'الشركات والفروع', icon: Building2, href: '/drvo/workspace/companies' },
  { label: 'المستخدمون والصلاحيات', icon: Users, href: '/drvo/workspace/users' },
  { label: 'الوحدات والتطبيقات', icon: Blocks, href: '/drvo/workspace/modules' },
  { label: 'الاشتراكات', icon: CreditCard, href: '/drvo/workspace/subscriptions' },
  { label: 'التقارير', icon: ChartNoAxesCombined },
];

const modules = [
  { title: 'المبيعات ونقاط البيع', subtitle: 'الفواتير والمدفوعات', icon: Wallet },
  { title: 'الحجوزات والمواعيد', subtitle: 'التقويم وإدارة الحجوزات', icon: CalendarDays },
  { title: 'الفريق والموارد البشرية', subtitle: 'الحضور والرواتب', icon: Users },
  { title: 'التقارير والتحليلات', subtitle: 'متابعة الأداء', icon: ChartNoAxesCombined },
];

export default async function DrvoWorkspace() {
  if (process.env.DRVO_STAGING_MODE !== 'true') redirect('/');
  const user = await getSession();
  if (!user) redirect('/login');

  return (
    <main dir="rtl" className="min-h-screen bg-[#080e1a] text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-[268px] shrink-0 border-l border-white/10 bg-[#0d1525] lg:flex lg:flex-col">
          <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
            <div className="grid size-11 place-items-center rounded-2xl bg-cyan-300 text-xl font-black text-slate-950">D</div>
            <div>
              <p className="text-xl font-black tracking-tight">DRVO <span className="text-cyan-300">ERP</span></p>
              <p className="text-[11px] tracking-widest text-slate-500">BUSINESS OS</p>
            </div>
          </div>
          <div className="px-4 pt-7">
            <p className="px-3 pb-3 text-[11px] font-semibold text-slate-500">مساحة العمل</p>
            <nav aria-label="القائمة الرئيسية" className="space-y-1">
              {navigation.map(({ label, icon: Icon, active, href }) => (
                <Link key={label} href={href ?? '#'} aria-disabled={!href && !active} aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${active ? 'bg-cyan-300/10 font-bold text-cyan-200 ring-1 ring-cyan-300/15' : href ? 'text-slate-200 hover:bg-white/5' : 'pointer-events-none text-slate-500'}`}>
                  <Icon className="size-[18px]" aria-hidden="true" />
                  <span>{label}</span>
                  {!active && !href && <span className="mr-auto text-[10px] text-slate-600">قريبًا</span>}
                </Link>
              ))}
            </nav>
          </div>
          <div className="mt-auto space-y-3 border-t border-white/10 p-5">
            <div className="flex items-center gap-2 text-xs text-slate-400"><ShieldCheck className="size-4 text-emerald-400" /> بيئة تجريبية معزولة</div>
            <Link href="/drvo" className="flex items-center gap-2 text-xs text-slate-400 hover:text-white"><ArrowUpLeft className="size-4" /> الموقع التعريفي</Link>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex min-h-20 items-center justify-between gap-4 border-b border-white/10 bg-[#0c1423]/80 px-5 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl border border-white/10 text-cyan-300 lg:hidden"><Menu className="size-5" /></div>
              <div>
                <p className="text-xs text-slate-500">DRVO ERP <ChevronLeft className="inline size-3" /> مساحة العمل</p>
                <p className="mt-1 text-sm font-bold sm:text-base">لوحة التحكم</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300 sm:inline-flex">STAGING</span>
              <div className="flex size-9 items-center justify-center rounded-xl border border-white/10 text-slate-400"><Bell className="size-4" /></div>
              <div className="flex items-center gap-2 border-r border-white/10 pr-3">
                <div className="grid size-9 place-items-center rounded-full bg-cyan-300/15 font-bold text-cyan-200">{user.UserName?.charAt(0)?.toUpperCase() || 'U'}</div>
                <div className="hidden sm:block"><p className="max-w-32 truncate text-sm font-semibold">{user.UserName}</p><p className="text-[11px] text-slate-500">{user.UserLevel === 'admin' ? 'مسؤول النظام' : 'مستخدم'}</p></div>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-[1360px] space-y-8 px-5 py-8 sm:px-8 lg:py-10">
            <section className="relative overflow-hidden rounded-3xl border border-cyan-300/15 bg-gradient-to-l from-[#12324a] via-[#102239] to-[#111a2c] p-6 sm:p-9">
              <div className="pointer-events-none absolute -left-20 -top-28 size-80 rounded-full bg-cyan-300/10 blur-3xl" />
              <div className="relative max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-medium text-cyan-200"><Activity className="size-3.5" /> DRVO ERP · FOUNDATION</div>
                <h1 className="text-2xl font-black leading-relaxed sm:text-4xl">أهلًا، {user.UserName} 👋</h1>
                <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">مساحة العمل جاهزة. بنجهز إدارة الشركات والفروع والصلاحيات والوحدات على أساس مستقل عن نظام الورديات القديم.</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <span className="rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-bold text-slate-950">المرحلة الأولى: ERP Foundation</span>
                  <span className="rounded-xl border border-white/15 px-4 py-2.5 text-xs text-slate-200">لا توجد عمليات POS مفعّلة</span>
                </div>
              </div>
            </section>

            <section aria-label="حالة المنصة" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { title: 'حالة الجلسة', value: 'متصل', note: 'تم التحقق من تسجيل الدخول', icon: ShieldCheck, tone: 'text-emerald-300' },
                { title: 'الشركة الحالية', value: 'مرتبطة بالجلسة', note: 'إدارة الشركات قيد التطوير', icon: Building2, tone: 'text-cyan-300' },
                { title: 'الوحدات', value: 'قيد التجهيز', note: 'التفعيل حسب الشركة والاشتراك', icon: Blocks, tone: 'text-violet-300' },
                { title: 'البيانات التشغيلية', value: 'غير متاحة بعد', note: 'لن نعرض أرقامًا تجريبية كأنها حقيقية', icon: ChartNoAxesCombined, tone: 'text-amber-300' },
              ].map(({ title, value, note, icon: Icon, tone }) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-[#101a2c] p-5">
                  <div className="flex items-center justify-between"><p className="text-xs text-slate-400">{title}</p><Icon className={`size-5 ${tone}`} /></div>
                  <p className="mt-5 text-lg font-bold">{value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{note}</p>
                </div>
              ))}
            </section>

            <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
              <section className="rounded-3xl border border-white/10 bg-[#101a2c] p-5 sm:p-7">
                <div className="mb-6 flex items-start justify-between gap-3">
                  <div><h2 className="text-lg font-bold">تطبيقات DRVO</h2><p className="mt-1 text-xs text-slate-400">الوحدات اللي بنجهزها لمساحة عملك</p></div>
                  <span className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-400">معاينة</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {modules.map(({ title, subtitle, icon: Icon }) => (
                    <div key={title} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-cyan-300/10 text-cyan-300"><Icon className="size-5" /></div>
                      <div><p className="text-sm font-bold">{title}</p><p className="mt-1 text-xs text-slate-500">{subtitle}</p><p className="mt-3 text-[11px] text-amber-300">غير مفعّل بعد</p></div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-3xl border border-white/10 bg-[#101a2c] p-5 sm:p-7">
                <h2 className="text-lg font-bold">الخطوات القادمة</h2>
                <p className="mt-1 text-xs text-slate-400">خطة تأسيس المنصة</p>
                <div className="mt-6 space-y-5">
                  {[
                    { title: 'مراجعة Tenant Architecture', detail: 'فحص الجداول والعزل الحالي', icon: GitBranch },
                    { title: 'الشركات والفروع', detail: 'واجهات الإدارة وربط البيانات', icon: Building2 },
                    { title: 'المستخدمون والصلاحيات', detail: 'العضويات والأدوار', icon: LockKeyhole },
                    { title: 'محرك الوحدات', detail: 'Module Registry وFeature Gates', icon: Settings2 },
                  ].map(({ title, detail, icon: Icon }, i) => (
                    <div key={title} className="flex items-center gap-3">
                      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/5 text-slate-300"><Icon className="size-4" /></div>
                      <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>
                      <span className="text-xs text-slate-600">0{i + 1}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5 text-xs text-slate-500">
              <span>DRVO ERP · بيئة Staging معزولة · البيانات التشغيلية غير متاحة في هذه المرحلة</span>
              <span className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-400" /> الوصول محمي بالجلسة</span>
            </footer>
          </div>
        </div>
      </div>
    </main>
  );
}
