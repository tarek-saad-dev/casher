'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SIGNUP_STEPS, localSignupPhone, signupStepError, type SignupDraft } from '@/platform/publicSignup/presentation';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleDollarSign,
  Eye, EyeOff, Loader2,
  ClipboardList,
  Package,
  ReceiptText,
  Scissors,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';
import type {
  PublicSignupIndustry,
} from '@/platform/publicSignup/types';
import {
  getPublicSignupAppChoices,
  resolvePublicSignupAppSelection,
} from '@/platform/publicSignup/appSelection';

const APP_INFO: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  booking: { label: 'الحجوزات', icon: CalendarDays },
  queue: { label: 'طابور العملاء', icon: Users },
  pos: { label: 'الكاشير والمبيعات', icon: ReceiptText },
  attendance: { label: 'الحضور', icon: Users },
  payroll: { label: 'المرتبات', icon: CircleDollarSign },
  treasury: { label: 'الخزنة', icon: ShieldCheck },
  reports: { label: 'التقارير', icon: ClipboardList },
  inventory: { label: 'المخزون', icon: Package },
  purchasing: { label: 'المشتريات', icon: Store },
};

type FormState = SignupDraft;

const initial: FormState = {
  industry: null,
  selectedApps: [],
  contactName: '',
  businessName: '',
  phone: '',
  email: '',
  password: '',
  confirmation: '',
  startMode: 'real',
};

export default function PublicSignupFlow() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [copied, setCopied] = useState(false);
  const submitting = useRef(false);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tenantCode: string; ownerLoginName: string; nextPath: string } | null>(null);

  const choices = form.industry ? getPublicSignupAppChoices(form.industry) : null;
  const selectionError = useMemo(() => {
    if (!form.industry) return null;
    try {
      resolvePublicSignupAppSelection(form.industry, form.selectedApps);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'اختيارات التطبيقات غير صحيحة.';
    }
  }, [form.industry, form.selectedApps]);

  const validationError = signupStepError(step, form, selectionError);
  const canContinue = !validationError;

  function goTo(next: number) {
    if (submitting.current) return;
    setError(null);
    setAttempted(false);
    setShowPassword(false);
    setStep(next);
  }

  const toggleApp = (code: string) => {
    if (choices?.apps.some((app) => app.code === code && app.group === 'required')) return;
    setForm((f) => ({
      ...f,
      selectedApps: f.selectedApps.includes(code)
        ? f.selectedApps.filter((x) => x !== code)
        : [...f.selectedApps, code],
    }));
  };

  const chooseIndustry = (industry: PublicSignupIndustry) => {
    setForm((f) => ({
      ...f,
      industry,
      startMode: industry === 'salon' ? f.startMode : 'real',
      selectedApps: getPublicSignupAppChoices(industry).defaults,
    }));
  };

  const submit = async () => {
    if (!form.industry || submitting.current || step !== 4) return;
    const invalid = signupStepError(4, form, selectionError);
    if (invalid) { setError(invalid); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/public/signup/complete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: form.industry,
          // Keep legacy needs analytics compatible; installed apps come from selectedApps.
          needs: [],
          selectedApps: form.selectedApps,
          contactName: form.contactName,
          businessName: form.businessName,
          phone: localSignupPhone(form.phone),
          email: form.email.trim() || null,
          password: form.password,
          startMode: form.startMode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        tenantCode?: string;
        ownerLoginName?: string;
        nextPath?: string;
      };
      if (!res.ok) throw new Error(data.error || 'تعذر إنشاء الحساب.');
      const nextPath = data.nextPath || '/operations';
      if (!data.ownerLoginName) throw new Error('تم إنشاء الحساب لكن بيانات الدخول غير متاحة. استخدم صفحة تسجيل الدخول.');
      setDone({ tenantCode: data.tenantCode || '', ownerLoginName: data.ownerLoginName, nextPath });
      setForm(f => ({ ...f, password: '', confirmation: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-[2rem] border border-emerald-400/20 bg-emerald-500/10 p-8 text-center shadow-2xl shadow-emerald-950/10">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400 text-slate-950">
          <Check className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-3xl font-black">حسابك جاهز</h2>
        <p className="mt-2 text-sm text-slate-300">
          مساحة عملك اتعملت والتجربة بدأت. احتفظ باسم الدخول عشان ترجع لحسابك في أي وقت.
        </p>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-right">
          <div className="text-xs text-slate-400">اسم الدخول المخصص لحسابك</div>
          <div dir="ltr" className="mt-2 break-all font-mono text-lg font-black text-cyan-300">{done.ownerLoginName}</div>
          <p className="mt-2 text-xs leading-6 text-slate-400">احتفظ باسم الدخول ده، هتحتاجه مع كلمة المرور اللي اخترتها عشان تدخل تاني.</p>
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(done.ownerLoginName); setCopied(true); } catch { setCopied(false); } }}
            className="mt-3 rounded-xl border border-white/15 px-3 py-2 text-xs font-bold hover:bg-white/10">
            {copied ? 'تم النسخ' : 'انسخ اسم الدخول'}
          </button>
        </div>
        <button
          type="button"
          onClick={() => window.location.assign(done.nextPath)}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-slate-950"
        >
          {done.nextPath === '/setup' ? 'جهّز منشأتك' : 'افتح مساحة العمل'}
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-400"><span>إنشاء حسابك</span><span>الخطوة {step + 1} من {SIGNUP_STEPS.length}</span></div>
        <div role="progressbar" aria-label="تقدم التسجيل" aria-valuemin={0} aria-valuemax={SIGNUP_STEPS.length} aria-valuenow={step + 1} className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-cyan-300 motion-safe:transition-all motion-safe:duration-300" style={{ width: ((step + 1) / SIGNUP_STEPS.length * 100) + '%' }} />
        </div>
        <nav aria-label="خطوات التسجيل" className="mt-3 grid grid-cols-5 gap-1 sm:gap-2">
          {SIGNUP_STEPS.map((label, n) => (
            <button key={label} type="button" aria-current={n === step ? 'step' : undefined} disabled={n > step || busy} onClick={() => goTo(n)}
              className={'flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] sm:text-xs ' + (n === step ? 'bg-cyan-300/10 font-bold text-cyan-200' : n < step ? 'text-slate-200 hover:bg-white/5' : 'text-slate-500')}>
              <span className={'grid h-6 w-6 place-items-center rounded-full ' + (n <= step ? 'bg-cyan-300 text-slate-950' : 'bg-white/10')}>{n < step ? <Check className="h-3.5 w-3.5" /> : n + 1}</span>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="rounded-[1.5rem] border border-white/10 bg-[#101c29] p-5 shadow-2xl shadow-black/30 sm:p-8" aria-busy={busy}>
        <div key={step} ref={heading} tabIndex={-1} className="outline-none motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
        {step === 0 && (
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">01 — النشاط</p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">بيزنسك إيه؟</h1>
            <p className="mt-2 text-sm text-slate-400">هنجهز DRVO على طبيعة شغلك من أول دقيقة.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                { code: 'salon' as const, title: 'صالون / Barbershop', desc: 'حجوزات + كاشير + فريق + رواتب', icon: Scissors },
                { code: 'supermarket' as const, title: 'متجر / Supermarket', desc: 'مبيعات + مخزون + مشتريات + تقارير', icon: Store },
              ].map((item) => {
                const Icon = item.icon;
                const active = form.industry === item.code;
                return (
                  <button
                    key={item.code}
                    type="button"
                    aria-pressed={active}
                    onClick={() => chooseIndustry(item.code)}
                    className={`rounded-3xl border p-5 text-right transition ${
                      active
                        ? 'border-cyan-300 bg-cyan-300/10'
                        : 'border-white/10 bg-black/10 hover:border-white/20 hover:bg-white/5'
                    }`}
                  >
                    <Icon className={`h-8 w-8 ${active ? 'text-cyan-300' : 'text-slate-400'}`} />
                    <div className="mt-5 text-lg font-bold">{item.title}</div>
                    <div className="mt-1 text-xs text-slate-400">{item.desc}</div>
                  </button>
                );
              })}
              <div className="rounded-3xl border border-dashed border-white/10 p-5 opacity-50">
                <Sparkles className="h-8 w-8 text-slate-500" />
                <div className="mt-5 text-lg font-bold">نشاط تاني</div>
                <div className="mt-1 text-xs text-slate-500">قريبًا — نفس DRVO، Pack مختلف.</div>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">02 — التطبيقات</p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">جهّز التطبيقات اللي تحتاجها.</h2>
            <p className="mt-2 text-sm text-slate-400">
              بدأنا بتطبيقات نشاطك الموصى بها. الأساسي ثابت، والباقي تقدر تضيفه أو تشيله قبل إنشاء الحساب.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {choices?.apps.map((item) => {
                const info = APP_INFO[item.code];
                const Icon = info?.icon ?? Package;
                const active = form.selectedApps.includes(item.code);
                const required = item.group === 'required';
                return (
                  <button
                    key={item.code}
                    type="button"
                    disabled={required}
                    aria-pressed={active}
                    onClick={() => toggleApp(item.code)}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-right transition disabled:cursor-default ${
                      active ? 'border-cyan-300/60 bg-cyan-300/10' : 'border-white/10 bg-black/10 hover:bg-white/5'
                    }`}
                  >
                    <span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? 'bg-cyan-300 text-slate-950' : 'bg-white/5 text-slate-400'}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-bold">{info?.label ?? item.code}</span>
                      <span className="block text-[11px] text-slate-400">
                        {required ? 'أساسي للنشاط' : item.group === 'recommended' ? 'موصى به · اختياري' : 'إضافة اختيارية'}
                        {item.requires.length ? ` · يحتاج ${item.requires.map((dep) => APP_INFO[dep]?.label ?? dep).join(' و')}` : ''}
                      </span>
                    </span>
                    {active && <Check className="h-4 w-4 text-cyan-300" />}
                  </button>
                );
              })}
            </div>
            {selectionError && <p role="alert" className="mt-3 rounded-xl border border-amber-400/30 px-4 py-2 text-xs text-amber-200">{selectionError}</p>}
            <p className="mt-3 text-xs text-slate-400">
              المختار: {form.selectedApps.length} تطبيقات · الخطة التجارية منفصلة عن التطبيقات، والتجربة تبدأ على Starter.
            </p>
            <div className="mt-3 rounded-2xl border border-amber-300/10 bg-amber-300/5 px-4 py-3 text-xs text-amber-100/70">
              WhatsApp + AI Receptionist مش متاحين للتسجيل الذاتي لحد ما ربط رقم مستقل لكل منشأة يبقى جاهز تجاريًا.
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">03 — عنك وعن البيزنس</p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">عرّفنا ببيزنسك.</h2>
            <p className="mt-2 text-sm text-slate-400">مفيش بطاقة بنكية. التجربة 14 يوم.</p>
            <div className="mt-6 grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-xs text-slate-400">اسمك</span>
                <input
                  autoComplete="name" maxLength={100} value={form.contactName}
                  onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300/60"
                  placeholder="مثال: محمد أحمد"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs text-slate-400">اسم النشاط</span>
                <input
                  autoComplete="organization" maxLength={200} value={form.businessName}
                  onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300/60"
                  placeholder="مثال: Nova Men Salon"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs text-slate-400">رقم الموبايل</span>
                  <input
                    type="tel" autoComplete="tel" inputMode="tel" maxLength={32}
                    dir="ltr"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left outline-none transition focus:border-cyan-300/60"
                    placeholder="01xxxxxxxxx أو +20"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs text-slate-400">الإيميل — اختياري</span>
                  <input
                    type="email" autoComplete="email" maxLength={254}
                    dir="ltr"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left outline-none transition focus:border-cyan-300/60"
                    placeholder="you@business.com"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">04 — البداية</p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">أمّن حسابك واختار البداية.</h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={form.startMode === 'real'}
                onClick={() => setForm((f) => ({ ...f, startMode: 'real' }))}
                className={`rounded-3xl border p-5 text-right ${
                  form.startMode === 'real' ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-black/10'
                }`}
              >
                <div className="text-lg font-bold">ابدأ ببياناتي الحقيقية</div>
                <div className="mt-2 text-xs leading-6 text-slate-400">حساب نظيف، ونكمل الخدمات والفريق جوه DRVO.</div>
              </button>
              <button
                type="button"
                disabled={form.industry !== 'salon'}
                aria-pressed={form.startMode === 'demo'}
                onClick={() => setForm((f) => ({ ...f, startMode: 'demo' }))}
                className={`rounded-3xl border p-5 text-right disabled:cursor-not-allowed disabled:opacity-40 ${
                  form.startMode === 'demo' ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-black/10'
                }`}
              >
                <div className="text-lg font-bold">ابدأ ببيانات تجريبية</div>
                <div className="mt-2 text-xs leading-6 text-slate-400">
                  للصالونات: خدمات وموظفين كمثال داخل حسابك؛ دي مش بيئة تدريب منفصلة. اختار البداية الحقيقية لو هتشتغل فورًا.
                </div>
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <label className="block space-y-1.5 text-sm"><span>كلمة مرور حساب المالك</span>
                <div className="flex gap-2">
                  <input type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="new-password" maxLength={128} value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none focus:border-cyan-300" placeholder="10 أحرف على الأقل" />
                  <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} aria-pressed={showPassword} className="grid min-h-11 w-12 place-items-center rounded-xl border border-white/15">{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
                </div>
              </label>
              <label className="block space-y-1.5 text-sm"><span>تأكيد كلمة المرور</span><input type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="new-password" maxLength={128}
                value={form.confirmation} onChange={e => setForm(f => ({ ...f, confirmation: e.target.value }))} className="w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 outline-none focus:border-cyan-300" /></label>
              <p className="text-xs text-slate-400">احتفظ بكلمة المرور؛ رقم الموبايل في التسجيل بيانات تواصل وليس رقمًا تم التحقق من ملكيته.</p>
            </div>

            <div className="mt-5 rounded-2xl border border-cyan-300/10 bg-cyan-300/5 p-4 text-xs leading-6 text-slate-300">
              في الخطوة الجاية هتراجع بياناتك قبل إنشاء مساحة العمل.
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <p className="text-xs font-bold text-cyan-300">05 — المراجعة</p>
            <h2 className="mt-2 text-3xl font-black">كل حاجة جاهزة؟</h2>
            <p className="mt-2 text-sm leading-7 text-slate-400">راجع التفاصيل قبل إنشاء حساب مستقل لبيزنسك.</p>
            <div className="mt-5 divide-y divide-white/10 rounded-2xl border border-white/10 bg-black/10 px-4">
              {[
                { label: 'النشاط', value: form.industry === 'salon' ? 'صالون / Barbershop' : 'متجر / Supermarket', edit: 0 },
                { label: 'التطبيقات', value: form.selectedApps.map(code => APP_INFO[code]?.label ?? code).join(' · '), edit: 1 },
                { label: 'اسم المنشأة', value: form.businessName, edit: 2 },
                { label: 'صاحب الحساب', value: form.contactName, edit: 2 },
                { label: 'رقم التواصل', value: localSignupPhone(form.phone) ?? form.phone, edit: 2 },
                { label: 'البريد', value: form.email || 'لم يتم إدخاله', edit: 2 },
                { label: 'طريقة البداية', value: form.startMode === 'demo' ? 'بيانات تجريبية داخل الحساب' : 'بياناتك الحقيقية', edit: 3 },
              ].map(item => <div key={item.label} className="flex items-start justify-between gap-4 py-3"><div className="min-w-0"><div className="text-xs text-slate-400">{item.label}</div><div className="mt-1 break-words text-sm font-bold">{item.value}</div></div><button type="button" disabled={busy} onClick={() => goTo(item.edit)} className="shrink-0 rounded-lg px-2 py-2 text-xs font-bold text-cyan-200 hover:bg-white/5">تعديل</button></div>)}
            </div>
            <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-4 text-sm"><div className="flex items-center gap-2 font-bold text-cyan-200"><ShieldCheck className="h-5 w-5" /> تجربة Starter لمدة 14 يوم</div><p className="mt-1 text-xs leading-6 text-slate-300">بدون بطاقة بنكية أو دفع الآن. كلمة المرور مش بتظهر في الملخص.</p></div>
          </div>
        )}
        </div>

        {attempted && validationError && <p role="alert" className="mt-4 text-sm text-amber-200">{validationError}</p>}
        {error && <p role="alert" className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}

        <div className="mt-7 flex items-center justify-between gap-3 border-t border-white/10 pt-5">
          <button
            type="button"
            disabled={step === 0 || busy}
            onClick={() => {
              goTo(Math.max(0, step - 1));
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-30"
          >
            <ArrowRight className="h-4 w-4" />
            رجوع
          </button>
          {step < SIGNUP_STEPS.length - 1 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!canContinue) { setAttempted(true); return; }
                goTo(step + 1);
              }}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-2.5 text-sm font-black text-slate-950 disabled:opacity-40"
            >
              {step === 3 ? 'راجع بياناتك' : 'التالي'}
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!canContinue || busy}
              onClick={() => void submit()}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-6 py-2.5 text-sm font-black text-slate-950 disabled:opacity-40"
            >
              {busy ? 'بنجهز بيزنسك…' : 'جهز حسابي'}
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
