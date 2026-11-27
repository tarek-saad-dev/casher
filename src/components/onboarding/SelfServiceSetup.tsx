'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import InlineSetupForm from './InlineSetupForm';
import LaunchSetup from './LaunchSetup';
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
  const router = useRouter();
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
  const next = currentStep === 'welcome' ? journey?.steps.slice(1, 5).find(item => !item.complete) ?? journey?.steps[5] : journey?.steps[index + 1];
  const previous = journey?.steps[index - 1];
  const nextIncomplete = journey?.steps.slice(1, 5).find(item => !item.complete);
  const [copied, setCopied] = useState(false);
  const Icon = ICONS[currentStep];
  const actions = SCREEN_ACTIONS[currentStep] ?? [];
  const inlineStep = currentStep === 'branch' || currentStep === 'services' || currentStep === 'team' ? currentStep : null;

  return (
    <main dir="rtl" className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-background text-right text-foreground">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-44 -top-40 h-[35rem] w-[35rem] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-60 left-0 h-[35rem] w-[35rem] rounded-full bg-brand/5 blur-3xl" />
      </div>
      <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-5 sm:px-7 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
          <Link href="/operations" className="flex items-center gap-3 text-xl font-black" aria-label="DRVOERP - لوحة التشغيل">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
              <Scissors className="h-5 w-5" />
            </span>
            <span dir="ltr">DRVO<span className="text-primary">ERP</span></span>
            <span className="hidden border-r border-border pr-3 text-xs font-normal text-muted-foreground sm:inline">تجهيز المنشأة</span>
          </Link>
          <Link href="/operations" className="rounded-full border border-input px-4 py-2 text-xs font-bold text-foreground transition hover:bg-muted hover:text-foreground">
            كمّل لاحقًا <ArrowLeft className="mr-1 inline h-3.5 w-3.5" />
          </Link>
        </header>

        {loading && !journey ? (
          <div role="status" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            بنراجع إعدادات بيزنسك…
          </div>
        ) : error && !journey ? (
          <div role="alert" className="mx-auto mt-20 max-w-lg rounded-3xl border border-destructive/30 bg-destructive-soft p-8 text-center">
            <CircleHelp className="mx-auto h-9 w-9 text-destructive" />
            <h1 className="mt-4 text-xl font-black">مش قادرين نحمّل حالة التجهيز</h1>
            <p className="mt-2 text-sm text-destructive">{error}</p>
            <button type="button" onClick={() => void refresh()} className="mt-5 rounded-full bg-card px-6 py-2.5 text-sm font-bold text-foreground">جرّب تاني</button>
          </div>
        ) : journey && step ? (
          <>
            <div className="mt-5 rounded-2xl border border-border bg-muted p-4 lg:hidden">
              <div className="flex items-center justify-between gap-2 text-xs"><span className="font-bold">{step.label} · {index + 1}/{journey.steps.length}</span><span className="font-bold text-primary">{journey.progressPercent}% مكتمل</span></div>
              <div role="progressbar" aria-label="اكتمال التجهيز" aria-valuemin={0} aria-valuemax={100} aria-valuenow={journey.progressPercent} className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary motion-safe:transition-all" style={{ width: journey.progressPercent + '%' }} /></div>
              <nav aria-label="خطوات التجهيز على الموبايل" className="mt-3 flex flex-wrap gap-1">
                {journey.steps.map(item => <Link key={item.id} href={item.href} aria-current={item.id === currentStep ? 'step' : undefined} className={'inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[11px] ' + (item.id === currentStep ? 'bg-primary-soft font-bold text-primary' : 'text-muted-foreground hover:bg-muted')}>{item.complete && <Check className="h-3 w-3 text-success" />}{item.label}</Link>)}
              </nav>
            </div>
            <div className="mt-5 grid gap-6 lg:mt-7 lg:grid-cols-[minmax(0,1fr)_270px] lg:gap-9">
              <section className="min-w-0">
                <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold tracking-widest text-primary">SETUP YOUR BUSINESS</div>
                    <div className="mt-1 text-lg font-bold text-foreground">{journey.tenantName}</div>
                  </div>
                  <button type="button" onClick={() => void refresh(true)} disabled={refreshing} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs text-foreground hover:bg-muted disabled:opacity-50">
                    <RefreshCw className={'h-3.5 w-3.5 ' + (refreshing ? 'animate-spin' : '')} /> تحديث التقدم
                  </button>
                </div>

                <div key={currentStep} className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
                  <div className="p-6 sm:p-9">
                    <div className="flex items-center justify-between gap-4">
                      <span className="rounded-full border border-primary/20 bg-primary-soft px-3 py-1.5 text-xs font-bold text-primary">
                        الخطوة {index + 1} من {journey.steps.length}
                      </span>
                      {currentStep !== 'welcome' && currentStep !== 'finish' && (
                        <span className={'inline-flex items-center gap-1.5 text-xs font-bold ' + (step.complete ? 'text-success' : 'text-warning')}>
                          {step.complete ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                          {step.complete ? 'موجودة في النظام' : 'لسه محتاجة تجهيز'}
                        </span>
                      )}
                    </div>
                    <div className="mt-5 grid h-12 w-12 sm:mt-7 sm:h-16 sm:w-16 place-items-center rounded-[1.4rem] border border-primary/20 bg-primary-soft text-primary">
                      <Icon className="h-8 w-8" />
                    </div>
                    <h1 className="mt-4 max-w-2xl text-2xl font-black leading-tight tracking-tight sm:text-4xl">{step.title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">{step.description}</p>

                    {currentStep === 'welcome' && (
                      <div className="mt-8 grid gap-3 sm:grid-cols-3">
                        {[
                          { icon: Store, value: journey.branchName, name: 'أول فرع' },
                          { icon: ShieldCheck, value: 'بيانات مستقلة', name: 'حساب منشأتك' },
                          { icon: CalendarDays, value: 'تجهيز مرن', name: 'كمّل في أي وقت' },
                        ].map((item) => {
                          const CardIcon = item.icon;
                          return (
                            <div key={item.name} className="min-w-0 rounded-2xl border border-border bg-muted p-4">
                              <CardIcon className="h-5 w-5 text-primary" />
                              <div className="mt-4 break-words text-sm font-bold">{item.value}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{item.name}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {currentStep === 'welcome' && journey.ownerLoginName && (
                      <div className="mt-5 rounded-2xl border border-primary/20 bg-primary-soft p-5">
                        <div className="text-xs font-bold text-foreground">احتفظ باسم دخول المالك</div>
                        <div dir="ltr" className="mt-2 text-left font-mono text-lg font-black text-primary">{journey.ownerLoginName}</div>
                        <p className="mt-2 text-xs leading-6 text-muted-foreground">هتستخدمه مع كلمة المرور اللي عملتها وقت التسجيل في أي دخول جديد.</p>
                        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(journey.ownerLoginName!); setCopied(true); } catch { setCopied(false); } }} className="mt-3 rounded-xl border border-input px-3 py-2 text-xs font-bold hover:bg-muted">{copied ? 'تم النسخ' : 'انسخ اسم الدخول'}</button>
                      </div>
                    )}

                    {currentStep === 'welcome' && nextIncomplete && <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary-soft p-4"><div><p className="text-xs text-muted-foreground">خطوتك التالية</p><p className="mt-1 font-bold">{nextIncomplete.title}</p></div><Link href={nextIncomplete.href} className="rounded-xl bg-primary px-3 py-2 text-xs font-black text-primary-foreground">ابدأ <ArrowLeft className="inline h-3 w-3" /></Link></div>}

                    {currentStep === 'branch' && (
                      <div className="mt-7 flex items-start gap-3 rounded-2xl border border-border bg-muted p-5">
                        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                        <div><div className="text-xs text-muted-foreground">الفرع المسجل</div><div className="mt-1 break-words font-bold">{journey.branchName}</div></div>
                      </div>
                    )}

                    {(currentStep === 'services' || currentStep === 'team') && (
                      <div className="mt-7 rounded-2xl border border-border bg-muted p-5">
                        <div className="text-xs text-muted-foreground">{currentStep === 'services' ? 'الخدمات المسجلة' : 'أفراد الفريق في الفرع الحالي'}</div>
                        <div className="mt-2 text-4xl font-black text-primary">{step.count ?? '—'}</div>
                        <p className="mt-2 text-xs leading-6 text-muted-foreground">ده العدد الحالي داخل منشأتك.</p>
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
                          return <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-border bg-muted p-4">
                            <EntryIcon className="h-5 w-5 text-primary" />
                            <span className="flex-1 text-sm font-bold">{item.title}</span>
                            <span className={entry.complete ? 'text-success' : 'text-warning'}>
                              {entry.complete ? <CheckCircle2 className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
                            </span>
                          </div>;
                        })}
                      </div>
                    )}

                    {currentStep === 'finish' && (
                      <div className="mt-8 rounded-3xl border border-primary/20 bg-primary-soft p-6">
                        <div className="flex items-center gap-3 text-primary">
                          <ShieldCheck className="h-7 w-7" />
                          <div className="text-lg font-black">{journey.ready ? 'مساحة عملك جاهزة' : 'مساحة عملك بتتجهز'}</div>
                        </div>
                        <p className="mt-3 text-sm leading-7 text-foreground">
                          {journey.ready
                            ? 'تقدر تبدأ التشغيل الداخلي. خليك متأكد من الأسعار والموظفين وإعدادات الورديات.'
                            : 'مش لازم تخلص كل حاجة دلوقتي. ارجع لأي خطوة ناقصة وقت ما تحتاج.'}
                        </p>
                        <div className="mt-4 rounded-xl bg-brand-soft p-4 text-foreground"><div className="text-xs text-brand">مساحة عملك</div><div className="mt-1 break-words text-xl font-black">{journey.tenantName}</div><div className="mt-1 text-xs text-muted-foreground">{journey.branchName}</div><div className="mt-4 flex justify-between text-xs"><span>اكتمال التجهيز الأساسي</span><b>{journey.progressPercent}%</b></div><div className="mt-2 h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:journey.progressPercent+'%'}}/></div></div>
                        <div className="mt-4 space-y-2">{journey.steps.slice(1,5).map(item=><Link key={item.id} href={item.href} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm"><span className={item.complete?'text-success':'text-muted-foreground'}>{item.complete?<CheckCircle2 className="h-5 w-5"/>:<Clock3 className="h-5 w-5"/>}</span><span className="flex-1 font-bold">{item.label}</span><span className="text-xs text-muted-foreground">{item.complete?'مكتمل':'كمّل الإعداد'}</span></Link>)}</div>
                        {journey.firstSaleStatus&&journey.firstSaleStatus!=='not_applicable'&&<div className="mt-4 rounded-xl border border-border bg-card p-4"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><CreditCard className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h3 className="font-black">أول فاتورة حقيقية</h3><p className="mt-1 text-xs leading-6 text-muted-foreground">{journey.firstSaleStatus==='done'?'تم تسجيل فاتورة مبيعات في المنشأة.':'لسه مفيش فاتورة مبيعات مسجلة في المنشأة. دي خطوة بعد التجهيز وليست شرطًا لإكماله.'}</p>{journey.firstSaleStatus==='done'&&journey.firstSaleCount!=null&&<p className="mt-2 text-sm font-bold text-primary">{journey.firstSaleCount} فاتورة مسجلة على مستوى المنشأة</p>}</div></div>{journey.ready&&journey.firstSaleStatus==='pending'&&<Link href="/income/pos" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground">افتح نقطة البيع <ArrowLeft className="h-4 w-4"/></Link>}<p className="mt-3 text-xs text-muted-foreground">فواتير التدريب لا تدخل في المؤشر. حدّث التقدم بعد أول عملية بيع.</p></div>}
                        <Link href="/setup/training" className="mt-4 inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-card px-4 py-2.5 text-xs font-bold text-primary">جرّب التدريب التفاعلي <ArrowLeft className="h-4 w-4"/></Link>
                        <Link href="/operations" className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-black text-primary-foreground hover:bg-primary-hover">
                          افتح لوحة التشغيل <ArrowLeft className="h-4 w-4" />
                        </Link>
                      </div>
                    )}

                    {currentStep === 'launch' && <LaunchSetup onSaved={() => refresh(true)} />}
                    {inlineStep && <InlineSetupForm key={inlineStep} step={inlineStep} onSaved={() => refresh(true)} onContinue={inlineStep === 'branch' && next ? () => router.push(next.href) : undefined} />}

                    {actions.length > 0 && (
                      <details className="mt-5 rounded-2xl border border-border p-4" open={currentStep === 'launch'}><summary className="cursor-pointer text-sm font-bold text-foreground">إعدادات متقدمة</summary><div className="mt-3 grid gap-3">
                        {actions.map((action) => (
                          <Link key={action.href} href={action.href} className="group flex items-center gap-4 rounded-2xl border border-primary/20 bg-primary-soft p-4 transition hover:bg-primary-soft">
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><ExternalLink className="h-4 w-4" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-black text-foreground">{action.label}</span>
                              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{action.hint}</span>
                            </span>
                            <ChevronLeft className="h-5 w-5 shrink-0 text-primary transition group-hover:-translate-x-1" />
                          </Link>
                        ))}
                      </div></details>
                    )}

                    <div className="mt-6 border-t border-border pt-6">
                      <h2 className="text-sm font-black">نصائح قبل ما تكمل</h2>
                      <ul className="mt-4 space-y-3">
                        {GUIDANCE[currentStep].map((item) => (
                          <li key={item} className="flex items-start gap-3 text-xs leading-6 text-muted-foreground sm:text-sm">
                            <Check className="mt-1 h-4 w-4 shrink-0 text-primary" /> {item}
                          </li>
                        ))}
                      </ul>
                      {currentStep === 'launch' && journey.bookingInstalled && (
                        <Link href="/bookings" className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline">
                          افتح الحجوزات الداخلية <ArrowLeft className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted px-6 py-5 sm:px-9">
                    {previous ? <Link href={previous.href} className="inline-flex items-center gap-2 text-sm font-bold text-foreground hover:text-foreground"><ArrowRight className="h-4 w-4" /> السابق</Link> : <span />}
                    {next ? (
                      <Link href={next.href} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-black text-primary-foreground transition hover:bg-primary-hover">
                        {currentStep === 'welcome' ? 'كمّل التجهيز' : step.complete ? 'التالي' : 'تخطي مؤقتًا'} <ArrowLeft className="h-4 w-4" />
                      </Link>
                    ) : <Link href="/operations" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-black text-primary-foreground">ابدأ الاستخدام <ArrowLeft className="h-4 w-4" /></Link>}
                  </div>
                </div>
                {error && <p role="alert" className="mt-3 rounded-2xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive">{error}</p>}
                <p className="mt-4 text-center text-xs text-muted-foreground">تقدر تكمل التجهيز في أي وقت. التقدم بيتحدث من بيانات منشأتك.</p>
              </section>

              <aside className="hidden lg:block lg:pt-2">
                <div className="rounded-2xl bg-brand-soft p-5 text-foreground lg:sticky lg:top-7">
                  <div className="flex items-center justify-between">
                    <h2 className="font-black">رحلة التجهيز</h2>
                    <span className="text-xs font-bold text-brand">{journey.progressPercent}%</span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary motion-safe:transition-all motion-safe:duration-500" style={{ width: journey.progressPercent + '%' }} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {journey.completeCount} من {journey.totalCount} خطوات أساسية مكتملة
                  </p>
                  <nav aria-label="خطوات تجهيز المنشأة" className="mt-6 grid gap-1.5">
                    {journey.steps.map((item, itemIndex) => {
                      const ItemIcon = ICONS[item.id];
                      const active = currentStep === item.id;
                      return <Link
                        key={item.id} href={item.href} aria-current={active ? 'step' : undefined}
                        className={'flex items-center gap-3 rounded-2xl border px-3 py-3 transition ' + (active ? 'border-brand bg-card text-foreground' : 'border-transparent text-muted-foreground hover:bg-card hover:text-foreground')}
                      >
                        <span className={'grid h-9 w-9 place-items-center rounded-xl ' + (active ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground')}><ItemIcon className="h-4 w-4" /></span>
                        <span className="flex-1 text-xs font-bold">{itemIndex + 1}. {item.label}</span>
                        {itemIndex > 0 && itemIndex < 5 && (item.complete ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Clock3 className="h-4 w-4 text-muted-foreground" />)}
                      </Link>;
                    })}
                  </nav>
                  <div className="mt-6 rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-foreground"><CreditCard className="h-4 w-4 text-brand" /> بدون دفع في التجهيز</div>
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">بياناتك داخل حساب منشأتك. لن يتم تفعيل الحجز العام أو الرسائل تلقائيًا.</p>
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
