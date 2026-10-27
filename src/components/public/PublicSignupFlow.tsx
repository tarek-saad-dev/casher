'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleDollarSign,
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
  PublicSignupStartMode,
} from '@/platform/publicSignup/types';
import { PUBLIC_SIGNUP_NEXT_PATH } from '@/platform/publicSignup/constants';
import {
  getPublicSignupAppChoices,
  resolvePublicSignupAppSelection,
} from '@/platform/publicSignup/appSelection';

const APP_INFO: Record<
  string,
  { label: string; blurb: string; icon: React.ComponentType<{ className?: string }> }
> = {
  booking: { label: 'الحجوزات', blurb: 'مواعيد العملاء وتوافر الفريق', icon: CalendarDays },
  queue: { label: 'طابور العملاء', blurb: 'استقبال walk-in وترتيب الدور', icon: Users },
  pos: { label: 'الكاشير والمبيعات', blurb: 'فواتير، طرق دفع، وربط بالخزنة', icon: ReceiptText },
  attendance: { label: 'الحضور', blurb: 'تسجيل حضور وانصراف الفريق', icon: Users },
  payroll: { label: 'المرتبات', blurb: 'أجور وعمولات مرتبطة بالتشغيل', icon: CircleDollarSign },
  treasury: { label: 'الخزنة', blurb: 'حركة النقد وإقفال الورديات', icon: ShieldCheck },
  reports: { label: 'التقارير', blurb: 'أداء اليوم والموظفين والفروع', icon: ClipboardList },
  inventory: { label: 'المخزون', blurb: 'أرصدة المنتجات داخل الفرع', icon: Package },
  purchasing: { label: 'المشتريات', blurb: 'أوامر شراء وترحيل للمخزون', icon: Store },
};

const GROUP_LABEL = {
  required: 'أساسي — لا يمكن إزالته',
  recommended: 'موصى به',
  optional: 'اختياري',
} as const;

type FormState = {
  industry: PublicSignupIndustry | null;
  selectedApps: string[];
  contactName: string;
  businessName: string;
  locationName: string;
  phone: string;
  email: string;
  password: string;
  startMode: PublicSignupStartMode;
};

const initial: FormState = {
  industry: null,
  selectedApps: [],
  contactName: '',
  businessName: '',
  locationName: '',
  phone: '',
  email: '',
  password: '',
  startMode: 'real',
};

export default function PublicSignupFlow() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tenantCode: string; nextPath: string } | null>(null);

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

  const canContinue = useMemo(() => {
    if (step === 0) return !!form.industry;
    if (step === 1) return form.selectedApps.length > 0 && !selectionError;
    if (step === 2) {
      const locationOk =
        form.locationName.trim().length === 0 || form.locationName.trim().length >= 2;
      return (
        form.contactName.trim().length >= 2 &&
        form.businessName.trim().length >= 2 &&
        locationOk &&
        /^01\d{9}$/.test(form.phone.replace(/\D/g, ''))
      );
    }
    return form.password.length >= 10;
  }, [form, step, selectionError]);

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
    if (!form.industry || busy) return;
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
          locationName: form.locationName.trim() || null,
          phone: form.phone,
          email: form.email || null,
          password: form.password,
          startMode: form.startMode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        tenantCode?: string;
        nextPath?: string;
      };
      if (!res.ok) throw new Error(data.error || 'تعذر إنشاء الحساب.');
      const nextPath = data.nextPath || PUBLIC_SIGNUP_NEXT_PATH;
      setDone({ tenantCode: data.tenantCode || '', nextPath });
      setTimeout(() => window.location.assign(nextPath), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-[2rem] border border-emerald-400/20 bg-emerald-500/10 p-8 text-center shadow-2xl shadow-emerald-950/10">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400 text-slate-950">
          <Check className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-3xl font-black">الحساب اتعمل</h2>
        <p className="mt-2 text-sm text-slate-300">
          بدأت الـ14 يوم التجريبية. هنفتح مساحة العمل عشان تشوف إيه المثبت وإيه اللي محتاج إعداد قبل التشغيل.
        </p>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-xs text-slate-300">
          {done.tenantCode}
        </div>
        <button
          type="button"
          onClick={() => window.location.assign(done.nextPath)}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-slate-950"
        >
          افتح مساحة العمل
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-2">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="flex flex-1 items-center gap-2">
            <div
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${
                n <= step ? 'bg-cyan-300 text-slate-950' : 'bg-white/10 text-slate-500'
              }`}
            >
              {n < step ? <Check className="h-4 w-4" /> : n + 1}
            </div>
            {n < 3 && <div className={`h-px flex-1 ${n < step ? 'bg-cyan-300' : 'bg-white/10'}`} />}
          </div>
        ))}
      </div>

      <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
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
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {choices?.apps.map((item) => {
                const info = APP_INFO[item.code];
                const Icon = info?.icon ?? Package;
                const active = form.selectedApps.includes(item.code);
                const required = item.group === 'required';
                const depLabels = item.requires
                  .map((dep) => APP_INFO[dep]?.label ?? dep)
                  .filter(Boolean);
                return (
                  <button
                    key={item.code}
                    type="button"
                    disabled={required}
                    aria-pressed={active}
                    onClick={() => toggleApp(item.code)}
                    className={`rounded-3xl border p-4 text-right transition disabled:cursor-default ${
                      active
                        ? 'border-cyan-300/70 bg-cyan-300/10'
                        : 'border-white/10 bg-black/10 hover:border-white/20 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${
                          active ? 'bg-cyan-300 text-slate-950' : 'bg-white/5 text-slate-400'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold">{info?.label ?? item.code}</span>
                          {active && <Check className="h-4 w-4 shrink-0 text-cyan-300" />}
                        </span>
                        <span className="mt-1 block text-[11px] leading-5 text-slate-400">
                          {info?.blurb ?? item.code}
                        </span>
                        <span className="mt-2 inline-flex flex-wrap gap-1.5">
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                            {GROUP_LABEL[item.group]}
                          </span>
                          {depLabels.length > 0 && (
                            <span className="rounded-full border border-amber-300/20 px-2 py-0.5 text-[10px] text-amber-100/80">
                              يحتاج: {depLabels.join(' · ')}
                            </span>
                          )}
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {selectionError && (
              <p role="alert" className="mt-3 rounded-xl border border-amber-400/30 px-4 py-2 text-xs text-amber-200">
                {selectionError}
              </p>
            )}
            <p className="mt-3 text-xs text-slate-400">
              المختار: {form.selectedApps.length} · التثبيت ≠ الدفع. التجربة 14 يوم بدون بطاقة.
            </p>
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-6 text-slate-400">
              واتساب والمساعد الذكي مش متاحين في التسجيل الذاتي حاليًا — يحتاجان ربط قناة لكل منشأة.
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">03 — عنك وعن البيزنس</p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">بيانات أساسية فقط.</h2>
            <p className="mt-2 text-sm text-slate-400">مفيش بطاقة بنكية. التجربة 14 يوم.</p>
            <div className="mt-6 grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-xs text-slate-400">اسمك</span>
                <input
                  value={form.contactName}
                  onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300/60"
                  placeholder="مثال: محمد أحمد"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs text-slate-400">اسم النشاط</span>
                <input
                  value={form.businessName}
                  onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300/60"
                  placeholder="مثال: Nova Men Salon"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs text-slate-400">اسم أول فرع / موقع — اختياري</span>
                <input
                  value={form.locationName}
                  onChange={(e) => setForm((f) => ({ ...f, locationName: e.target.value }))}
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-cyan-300/60"
                  placeholder="مثال: فرع سموحة"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs text-slate-400">رقم الموبايل</span>
                  <input
                    inputMode="tel"
                    dir="ltr"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left outline-none transition focus:border-cyan-300/60"
                    placeholder="01xxxxxxxxx"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs text-slate-400">الإيميل — اختياري</span>
                  <input
                    type="email"
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
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">تحب تبدأ إزاي؟</h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
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
                onClick={() => setForm((f) => ({ ...f, startMode: 'demo' }))}
                className={`rounded-3xl border p-5 text-right disabled:cursor-not-allowed disabled:opacity-40 ${
                  form.startMode === 'demo' ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-black/10'
                }`}
              >
                <div className="text-lg font-bold">ابدأ ببيانات تجريبية</div>
                <div className="mt-2 text-xs leading-6 text-slate-400">
                  للصالونات: خدمات وموظفين تجريبيين عشان تشوف النظام من أول دخول.
                </div>
              </button>
            </div>

            <label className="mt-5 grid gap-1.5">
              <span className="text-xs text-slate-400">كلمة مرور حساب المالك</span>
              <input
                type="password"
                dir="ltr"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left outline-none transition focus:border-cyan-300/60"
                placeholder="10 أحرف على الأقل"
              />
              <span className="text-[11px] text-slate-500">
                V1 بيستخدم كلمة مرور آمنة في الخطوة الأخيرة. التحقق بالموبايل هيتضاف مع مزود OTP مستقل.
              </span>
            </label>

            <div className="mt-5 rounded-2xl border border-cyan-300/10 bg-cyan-300/5 p-4 text-xs leading-6 text-slate-300">
              بالضغط على «جهز حسابي» هنعمل Tenant مستقل، أول فرع، اشتراك Starter تجريبي 14 يوم، وإعدادات النشاط تلقائيًا.
            </div>
          </div>
        )}

        {error && <p className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}

        <div className="mt-7 flex items-center justify-between gap-3 border-t border-white/10 pt-5">
          <button
            type="button"
            disabled={step === 0 || busy}
            onClick={() => {
              setError(null);
              setStep((s) => Math.max(0, s - 1));
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-30"
          >
            <ArrowRight className="h-4 w-4" />
            رجوع
          </button>
          {step < 3 ? (
            <button
              type="button"
              disabled={!canContinue}
              onClick={() => {
                setError(null);
                setStep((s) => Math.min(3, s + 1));
              }}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-2.5 text-sm font-black text-slate-950 disabled:opacity-40"
            >
              كمل
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
              <Sparkles className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
