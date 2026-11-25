'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import InlineSetupForm from './InlineSetupForm';
import {
  ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, Check, CheckCircle2,
  ChevronLeft, CircleHelp, Clock3, CreditCard, ExternalLink, Loader2,
  MapPin, RefreshCw, Rocket, Scissors, ShieldCheck, Sparkles, Store, Users,
} from 'lucide-react';
import type { SelfServiceStepId } from '@/platform/onboarding/selfServiceJourney';
import type { buildSelfServiceJourney } from '@/platform/onboarding/selfServiceJourney';

type Journey = ReturnType<typeof buildSelfServiceJourney>;
type Props = { currentStep: SelfServiceStepId };
type Action = { label: string; href: string; hint: string };

const ICONS = {
  welcome: Sparkles, branch: Store, services: Scissors,
  team: Users, launch: Rocket, finish: BadgeCheck,
} as const;

const SCREEN_ACTIONS: Partial<Record<SelfServiceStepId, Action[]>> = {
  branch: [
    { label: 'افتح إعدادات الفروع', href: '/admin/branches', hint: 'حدّث العنوان ورقم المحل ومواعيد العمل' },
  ],
  services: [
    { label: 'افتح إدارة الخدمات', href: '/admin/services', hint: 'ضيف خدمة وسعرها ومدتها، وراجع ظهورها في الحجوزات' },
  ],
  team: [
    { label: 'افتح إدارة الموظفين', href: '/admin/employees', hint: 'ضيف حلاق وحدد جدول عمله والفرع' },
  ],
  launch: [
    { label: 'راجع يوم التشغيل', href: '/admin/day', hint: 'ابدأ يوم الشغل للفرع الصحيح' },
    { label: 'راجع الورديات', href: '/admin/shift', hint: 'افتح وردية الموظف أو الكاشير' },
    { label: 'افتح نقطة البيع', href: '/income/pos', hint: 'بعد تجهيز الخدمات والفريق والوردية' },
  ],
};

const GUIDANCE: Record<SelfServiceStepId, string[]> = {
  welcome: [
    'جهزنا حساب مالك مستقل وفرع أولي باسم نشاطك.',
    'ضيف بياناتك واحفظها من كل خطوة. التقدم بيتحدث من النظام تلقائيًا.',
    'تقدر ترجع هنا في أي وقت من نفس الرابط وتكمل اللي ناقصك.',
  ],
  branch: [
    'تأكد من رقم التليفون ومواعيد الفتح والقفل.',
    'راجع عنوان الفرع والمنطقة الزمنية.',
    'وجود فرع نشط لا يعني إن كل تفاصيله مكتملة؛ راجعها بنفسك.',
  ],
  services: [
    'ابدأ بالخدمات اللي بتتطلب بشكل يومي، زي حلاقة الشعر والذقن.',
    'اكتب السعر ومدة كل خدمة بدقة عشان الحجوزات.',
    'تقدر تضيف باقي الخدمات لاحقًا من نفس الشاشة.',
  ],
  team: [
    'ضيف الحلاقين الموجودين حاليًا فقط.',
    'حدد كل موظف بيشتغل في أي فرع ومواعيده.',
    'تأكد من الصلاحيات والرواتب قبل الاستخدام الفعلي.',
  ],
  launch: [
    'راجع وسيلة الدفع وإعدادات الفرع قبل استقبال أول عميل.',
    'افتح يوم عمل ووردية مناسبة.',
    'جرّب مسار الحجز والكاشير داخليًا قبل استخدامه مع العملاء.',
  ],
  finish: [
    'التجهيز الداخلي غير معناه نشر رابط الحجز للجمهور.',
    'واتساب والمساعد الذكي محتاجين ربط منفصل، ومش بيتفعلوا تلقائيًا.',
    'تقدر ترجع لخطوات التجهيز بعد بدء الاستخدام.',
  ],
};

export default function SelfServiceSetup({ currentStep }: Props) {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/tenant/onboarding', {
        credentials: 'include', cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean; journey?: Journey; error?: string;
      };
      if (!response.ok || !data.ok || !data.journey) {
        throw new Error(data.error || 'تعذر تحميل إعداد المنشأة.');
      }
      setJourney(data.journey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل إعداد المنشأة.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const index = journey?.steps.findIndex((step) => step.id === currentStep) ?? 0;
  const step = journey?.steps[index];
  const next = journey?.steps[index + 1];
  const previous = journey?.steps[index - 1];
  const Icon = ICONS[currentStep];
  const actions = SCREEN_ACTIONS[currentStep] ?? [];
  const inlineStep = currentStep === 'branch' || currentStep === 'services' || currentStep === 'team' ? currentStep : null;

  return (
    <main dir="rtl" className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-[#071018] text-right text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-44 -top-40 h-[35rem] w-[35rem] rounded-full bg-cyan-400/[0.09] blur-3xl" />
        <div className="absolute -bottom-60 left-0 h-[35rem] w-[35rem] rounded-full bg-blue-500/[0.08] blur-3xl" />
      </div>
      <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-5 sm:px-7 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
          <Link href="/operations" className="flex items-center gap-3 text-xl font-black" aria-label="DRVOERP - لوحة التشغيل">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-300 text-slate-950">
              <Scissors className="h-5 w-5" />
            </span>
            <span dir="ltr">DRVO<span className="text-cyan-300">ERP</span></span>
            <span className="hidden border-r border-white/10 pr-3 text-xs font-normal text-slate-400 sm:inline">تجهيز المنشأة</span>
          </Link>
          <Link href="/operations" className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white">
            الدخول للنظام <ArrowLeft className="mr-1 inline h-3.5 w-3.5" />
          </Link>
        </header>

        {loading && !journey ? (
          <div role="status" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-slate-300">
            <Loader2 className="h-10 w-10 animate-spin text-cyan-300" />
            بنراجع إعدادات بيزنسك…
          </div>
        ) : error && !journey ? (
          <div role="alert" className="mx-auto mt-20 max-w-lg rounded-3xl border border-rose-400/20 bg-rose-400/10 p-8 text-center">
            <CircleHelp className="mx-auto h-9 w-9 text-rose-300" />
            <h1 className="mt-4 text-xl font-black">مش قادرين نحمّل حالة التجهيز</h1>
            <p className="mt-2 text-sm text-rose-100">{error}</p>
            <button type="button" onClick={() => void refresh()} className="mt-5 rounded-full bg-white px-6 py-2.5 text-sm font-bold text-slate-950">جرّب تاني</button>
          </div>
        ) : journey && step ? (
          <>
            <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_290px] lg:gap-9">
              <section className="min-w-0">
                <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold tracking-widest text-cyan-300">SETUP YOUR BUSINESS</div>
                    <div className="mt-1 text-lg font-bold text-slate-100">{journey.tenantName}</div>
                  </div>
                  <button type="button" onClick={() => void refresh(true)} disabled={refreshing} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50">
                    <RefreshCw className={'h-3.5 w-3.5 ' + (refreshing ? 'animate-spin' : '')} /> تحديث التقدم
                  </button>
                </div>

                <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#101C29]/95 shadow-2xl shadow-black/20">
                  <div className="p-6 sm:p-9">
                    <div className="flex items-center justify-between gap-4">
                      <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold text-cyan-200">
                        الخطوة {index + 1} من {journey.steps.length}
                      </span>
                      {currentStep !== 'welcome' && currentStep !== 'finish' && (
                        <span className={'inline-flex items-center gap-1.5 text-xs font-bold ' + (step.complete ? 'text-emerald-300' : 'text-amber-200')}>
                          {step.complete ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                          {step.complete ? 'موجودة في النظام' : 'لسه محتاجة تجهيز'}
                        </span>
                      )}
                    </div>
                    <div className="mt-9 grid h-16 w-16 place-items-center rounded-[1.4rem] border border-cyan-300/20 bg-cyan-300/10 text-cyan-300">
                      <Icon className="h-8 w-8" />
                    </div>
                    <h1 className="mt-6 max-w-2xl text-3xl font-black leading-tight tracking-tight sm:text-4xl">{step.title}</h1>
                    <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-400 sm:text-base">{step.description}</p>

                    {currentStep === 'welcome' && (
                      <div className="mt-8 grid gap-3 sm:grid-cols-3">
                        {[
                          { icon: Store, value: journey.branchName, name: 'أول فرع' },
                          { icon: ShieldCheck, value: 'بيانات مستقلة', name: 'حساب منشأتك' },
                          { icon: CalendarDays, value: 'حساب المنشأة', name: 'اشتراكك' },
                        ].map((item) => {
                          const CardIcon = item.icon;
                          return (
                            <div key={item.name} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                              <CardIcon className="h-5 w-5 text-cyan-300" />
                              <div className="mt-4 break-words text-sm font-bold">{item.value}</div>
                              <div className="mt-1 text-xs text-slate-500">{item.name}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {currentStep === 'welcome' && journey.ownerLoginName && (
                      <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-5">
                        <div className="text-xs font-bold text-slate-300">احتفظ باسم دخول المالك</div>
                        <div dir="ltr" className="mt-2 text-left font-mono text-lg font-black text-cyan-300">{journey.ownerLoginName}</div>
                        <p className="mt-2 text-xs leading-6 text-slate-400">هتستخدمه مع كلمة المرور اللي عملتها وقت التسجيل في أي دخول جديد.</p>
                      </div>
                    )}

                    {currentStep === 'branch' && (
                      <div className="mt-7 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
                        <div><div className="text-xs text-slate-400">الفرع المسجل</div><div className="mt-1 break-words font-bold">{journey.branchName}</div></div>
                      </div>
                    )}

                    {(currentStep === 'services' || currentStep === 'team') && (
                      <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                        <div className="text-xs text-slate-400">{currentStep === 'services' ? 'الخدمات المسجلة' : 'أفراد الفريق المسجلين'}</div>
                        <div className="mt-2 text-4xl font-black text-cyan-300">{step.count ?? '—'}</div>
                        <p className="mt-2 text-xs leading-6 text-slate-500">ده العدد الحالي داخل منشأتك.</p>
                      </div>
                    )}

                    {currentStep === 'launch' && (
                      <div className="mt-7 grid gap-3 sm:grid-cols-2">
                        {[
                          { id: 'branch', title: 'الفرع', icon: Store },
                          { id: 'services', title: 'الخدمات', icon: Scissors },
                          { id: 'team', title: 'الفريق', icon: Users },
                        ].map((item) => {
                          const entry = journey.steps.find((s) => s.id === item.id)!;
                          const EntryIcon = item.icon;
                          return <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <EntryIcon className="h-5 w-5 text-cyan-300" />
                            <span className="flex-1 text-sm font-bold">{item.title}</span>
                            <span className={entry.complete ? 'text-emerald-300' : 'text-amber-300'}>
                              {entry.complete ? <CheckCircle2 className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
                            </span>
                          </div>;
                        })}
                      </div>
                    )}

                    {currentStep === 'finish' && (
                      <div className="mt-8 rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.06] p-6">
                        <div className="flex items-center gap-3 text-cyan-200">
                          <ShieldCheck className="h-7 w-7" />
                          <div className="text-lg font-black">{journey.ready ? 'أساسيات التشغيل جاهزة' : 'إعداداتك محفوظة وممكن تكملها'}</div>
                        </div>
                        <p className="mt-3 text-sm leading-7 text-slate-300">
                          {journey.ready
                            ? 'تقدر تبدأ التشغيل الداخلي. خليك متأكد من الأسعار والموظفين وإعدادات الورديات.'
                            : 'مش لازم تخلص كل حاجة دلوقتي. ارجع لأي خطوة ناقصة وقت ما تحتاج.'}
                        </p>
                        <Link href="/operations" className="mt-5 inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 hover:bg-cyan-200">
                          افتح لوحة التشغيل <ArrowLeft className="h-4 w-4" />
                        </Link>
                      </div>
                    )}

                    {inlineStep && <InlineSetupForm key={inlineStep} step={inlineStep} onSaved={() => refresh(true)} />}

                    {actions.length > 0 && (
                      <div className="mt-8 grid gap-3">
                        {actions.map((action) => (
                          <Link key={action.href} href={action.href} className="group flex items-center gap-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.07] p-4 transition hover:bg-cyan-300/[0.12]">
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan-300 text-slate-950"><ExternalLink className="h-4 w-4" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-black text-white">{action.label}</span>
                              <span className="mt-1 block text-xs leading-5 text-slate-400">{action.hint}</span>
                            </span>
                            <ChevronLeft className="h-5 w-5 shrink-0 text-cyan-300 transition group-hover:-translate-x-1" />
                          </Link>
                        ))}
                      </div>
                    )}

                    <div className="mt-8 border-t border-white/10 pt-6">
                      <h2 className="text-sm font-black">نصائح قبل ما تكمل</h2>
                      <ul className="mt-4 space-y-3">
                        {GUIDANCE[currentStep].map((item) => (
                          <li key={item} className="flex items-start gap-3 text-xs leading-6 text-slate-400 sm:text-sm">
                            <Check className="mt-1 h-4 w-4 shrink-0 text-cyan-300" /> {item}
                          </li>
                        ))}
                      </ul>
                      {currentStep === 'launch' && journey.bookingInstalled && (
                        <Link href="/bookings" className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-cyan-200 hover:underline">
                          افتح الحجوزات الداخلية <ArrowLeft className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/20 px-6 py-5 sm:px-9">
                    {previous ? <Link href={previous.href} className="inline-flex items-center gap-2 text-sm font-bold text-slate-300 hover:text-white"><ArrowRight className="h-4 w-4" /> السابق</Link> : <span />}
                    {next ? (
                      <Link href={next.href} className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200">
                        {step.complete || currentStep === 'welcome' ? 'التالي' : 'تخطي مؤقتًا'} <ArrowLeft className="h-4 w-4" />
                      </Link>
                    ) : <Link href="/operations" className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-black text-slate-950">ابدأ الاستخدام <ArrowLeft className="h-4 w-4" /></Link>}
                  </div>
                </div>
                {error && <p role="alert" className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</p>}
                <p className="mt-4 text-center text-xs text-slate-500">تقدر تسيب التجهيز وتكمله بعدين من /setup — حالة كل خطوة بتتحدث من النظام.</p>
              </section>

              <aside className="lg:pt-2">
                <div className="rounded-[1.7rem] border border-white/10 bg-white/[0.045] p-5 lg:sticky lg:top-7">
                  <div className="flex items-center justify-between">
                    <h2 className="font-black">رحلة التجهيز</h2>
                    <span className="text-xs font-bold text-cyan-300">{journey.progressPercent}%</span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-cyan-300 transition-all duration-500" style={{ width: journey.progressPercent + '%' }} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {journey.completeCount} من {journey.totalCount} خطوات أساسية مكتملة
                  </p>
                  <nav aria-label="خطوات تجهيز المنشأة" className="mt-6 grid gap-1.5">
                    {journey.steps.map((item, itemIndex) => {
                      const ItemIcon = ICONS[item.id];
                      const active = currentStep === item.id;
                      return <Link
                        key={item.id} href={item.href} aria-current={active ? 'step' : undefined}
                        className={'flex items-center gap-3 rounded-2xl border px-3 py-3 transition ' + (active ? 'border-cyan-300/40 bg-cyan-300/10 text-white' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white')}
                      >
                        <span className={'grid h-9 w-9 place-items-center rounded-xl ' + (active ? 'bg-cyan-300 text-slate-950' : 'bg-white/[0.06] text-slate-300')}><ItemIcon className="h-4 w-4" /></span>
                        <span className="flex-1 text-xs font-bold">{itemIndex + 1}. {item.label}</span>
                        {itemIndex > 0 && itemIndex < 5 && (item.complete ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <Clock3 className="h-4 w-4 text-slate-600" />)}
                      </Link>;
                    })}
                  </nav>
                  <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-200"><CreditCard className="h-4 w-4 text-cyan-300" /> بدون دفع في التجهيز</div>
                    <p className="mt-2 text-xs leading-6 text-slate-500">بياناتك داخل حساب منشأتك. لن يتم تفعيل الحجز العام أو الرسائل تلقائيًا.</p>
                  </div>
                </div>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
