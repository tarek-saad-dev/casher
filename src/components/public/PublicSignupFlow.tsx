'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, CircleDollarSign, ClipboardList,
  Package, ReceiptText, Scissors, ShieldCheck, Sparkles, Stethoscope, Store, Users,
} from 'lucide-react';
import type {
  PublicIndustryOption,
  PublicSignupNeed,
  PublicSignupStartMode,
} from '@/platform/publicSignup/types';

type NeedOption = { code: PublicSignupNeed; label: string };
type OptionsResponse = { industries: PublicIndustryOption[]; needs: NeedOption[] };

const NEED_ICONS: Record<PublicSignupNeed, React.ComponentType<{ className?: string }>> = {
  booking: CalendarDays,
  pos: ReceiptText,
  workforce: Users,
  payroll: CircleDollarSign,
  treasury: ShieldCheck,
  reports: ClipboardList,
  inventory: Package,
};

const INDUSTRY_ICONS: Record<
  PublicIndustryOption['iconKey'],
  React.ComponentType<{ className?: string }>
> = {
  scissors: Scissors,
  store: Store,
  clinic: Stethoscope,
};

type FormState = {
  industry: string | null;
  needs: PublicSignupNeed[];
  contactName: string;
  businessName: string;
  phone: string;
  email: string;
  password: string;
  startMode: PublicSignupStartMode;
};

const initial: FormState = {
  industry: null,
  needs: [],
  contactName: '',
  businessName: '',
  phone: '',
  email: '',
  password: '',
  startMode: 'real',
};

export default function PublicSignupFlow() {
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tenantCode: string; nextPath: string } | null>(null);

  useEffect(() => {
    fetch('/api/public/signup/options', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('تعذر تحميل أنواع الأنشطة.');
        return (await res.json()) as OptionsResponse;
      })
      .then(setOptions)
      .catch((err: Error) => setOptionsError(err.message));
  }, []);

  const selectedIndustry =
    options?.industries.find((x) => x.code === form.industry) ?? null;

  const canContinue = useMemo(() => {
    if (step === 0) return !!selectedIndustry;
    if (step === 1) return form.needs.length > 0;
    if (step === 2) {
      return (
        form.contactName.trim().length >= 2 &&
        form.businessName.trim().length >= 2 &&
        /^01\d{9}$/.test(form.phone.replace(/\D/g, ''))
      );
    }
    return form.password.length >= 10;
  }, [form, selectedIndustry, step]);

  const toggleNeed = (code: PublicSignupNeed) => {
    setForm((f) => ({
      ...f,
      needs: f.needs.includes(code) ? f.needs.filter((x) => x !== code) : [...f.needs, code],
    }));
  };

  const chooseIndustry = (industry: PublicIndustryOption) => {
    const known = new Set(options?.needs.map((x) => x.code) ?? []);
    const defaults = industry.defaultNeeds.filter((x): x is PublicSignupNeed =>
      known.has(x as PublicSignupNeed),
    );
    setForm((f) => ({
      ...f,
      industry: industry.code,
      needs: defaults,
      startMode: industry.supportsDemo ? f.startMode : 'real',
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
          needs: form.needs,
          contactName: form.contactName,
          businessName: form.businessName,
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
      const nextPath = data.nextPath || '/operations';
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
      <div className="mx-auto max-w-xl rounded-[2rem] border border-emerald-400/20 bg-emerald-500/10 p-8 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400 text-slate-950">
          <Check className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-3xl font-black">جاهز 🎉</h2>
        <p className="mt-2 text-sm text-slate-300">DRVO جهّز بيزنسك وبدأت الـ14 يوم التجريبية.</p>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-xs text-slate-300">
          {done.tenantCode}
        </div>
        <button type="button" onClick={() => window.location.assign(done.nextPath)} className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-slate-950">
          افتح DRVO <ArrowLeft className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-2">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="flex flex-1 items-center gap-2">
            <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${n <= step ? 'bg-cyan-300 text-slate-950' : 'bg-white/10 text-slate-500'}`}>
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
            <p className="mt-2 text-sm text-slate-400">كل نشاط Pack بيانات وإعدادات — نفس الـCore ونفس التطبيقات.</p>
            {optionsError && <p className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{optionsError}</p>}
            {!options && !optionsError && <p className="mt-6 text-sm text-slate-400">بنجهز أنواع الأنشطة…</p>}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {options?.industries.map((item) => {
                const Icon = INDUSTRY_ICONS[item.iconKey] ?? Sparkles;
                const active = form.industry === item.code;
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => chooseIndustry(item)}
                    className={`rounded-3xl border p-5 text-right transition ${active ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-black/10 hover:border-white/20 hover:bg-white/5'}`}
                  >
                    <Icon className={`h-8 w-8 ${active ? 'text-cyan-300' : 'text-slate-400'}`} />
                    <div className="mt-5 text-lg font-bold">{item.titleAr}</div>
                    <div className="mt-1 text-xs text-slate-400">{item.descriptionAr}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">02 — احتياجاتك</p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">عاوز DRVO يمسك إيه؟</h2>
            <p className="mt-2 text-sm text-slate-400">الاختيارات بتساعدنا في التجهيز؛ الـIndustry Pack هو اللي يحدد الـrecipe الأساسية.</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {options?.needs.map((item) => {
                const Icon = NEED_ICONS[item.code];
                const active = form.needs.includes(item.code);
                return (
                  <button key={item.code} type="button" onClick={() => toggleNeed(item.code)} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-right transition ${active ? 'border-cyan-300/60 bg-cyan-300/10' : 'border-white/10 bg-black/10 hover:bg-white/5'}`}>
                    <span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? 'bg-cyan-300 text-slate-950' : 'bg-white/5 text-slate-400'}`}><Icon className="h-4 w-4" /></span>
                    <span className="flex-1 text-sm font-bold">{item.label}</span>
                    {active && <Check className="h-4 w-4 text-cyan-300" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">03 — عنك وعن البيزنس</p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">3 بيانات ونبدأ.</h2>
            <p className="mt-2 text-sm text-slate-400">مفيش بطاقة بنكية. التجربة 14 يوم.</p>
            <div className="mt-6 grid gap-3">
              <label className="grid gap-1.5"><span className="text-xs text-slate-400">اسمك</span><input value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-300/60" /></label>
              <label className="grid gap-1.5"><span className="text-xs text-slate-400">اسم النشاط</span><input value={form.businessName} onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-cyan-300/60" placeholder="مثال: Care Clinic" /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5"><span className="text-xs text-slate-400">رقم الموبايل</span><input inputMode="tel" dir="ltr" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left outline-none focus:border-cyan-300/60" placeholder="01xxxxxxxxx" /></label>
                <label className="grid gap-1.5"><span className="text-xs text-slate-400">الإيميل — اختياري</span><input type="email" dir="ltr" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left outline-none focus:border-cyan-300/60" /></label>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-300">04 — البداية</p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">تحب تبدأ إزاي؟</h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setForm((f) => ({ ...f, startMode: 'real' }))} className={`rounded-3xl border p-5 text-right ${form.startMode === 'real' ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-black/10'}`}>
                <div className="text-lg font-bold">ابدأ ببياناتي الحقيقية</div>
                <div className="mt-2 text-xs leading-6 text-slate-400">حساب نظيف، ونكمل الإعداد من جوه DRVO.</div>
              </button>
              <button type="button" disabled={!selectedIndustry?.supportsDemo} onClick={() => setForm((f) => ({ ...f, startMode: 'demo' }))} className={`rounded-3xl border p-5 text-right disabled:opacity-40 ${form.startMode === 'demo' ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/10 bg-black/10'}`}>
                <div className="text-lg font-bold">ابدأ ببيانات تجريبية</div>
                <div className="mt-2 text-xs leading-6 text-slate-400">{selectedIndustry?.supportsDemo ? 'Demo خفيف مناسب للنشاط — من غير بيانات مالية أو طبية مزيفة.' : 'Demo لهذا النشاط لسه مش متاح.'}</div>
              </button>
            </div>
            <label className="mt-5 grid gap-1.5"><span className="text-xs text-slate-400">كلمة مرور حساب المالك</span><input type="password" dir="ltr" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left outline-none focus:border-cyan-300/60" placeholder="10 أحرف على الأقل" /></label>
            <div className="mt-5 rounded-2xl border border-cyan-300/10 bg-cyan-300/5 p-4 text-xs leading-6 text-slate-300">هننشئ Tenant مستقل، أول {selectedIndustry?.terminology.branch ?? 'فرع'}، Starter Trial لمدة 14 يوم، والـApps المناسبة للنشاط.</div>
          </div>
        )}

        {error && <p className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}

        <div className="mt-7 flex items-center justify-between gap-3 border-t border-white/10 pt-5">
          <button type="button" disabled={step === 0 || busy} onClick={() => { setError(null); setStep((s) => Math.max(0, s - 1)); }} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-30"><ArrowRight className="h-4 w-4" /> رجوع</button>
          {step < 3 ? (
            <button type="button" disabled={!canContinue} onClick={() => { setError(null); setStep((s) => Math.min(3, s + 1)); }} className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-2.5 text-sm font-black text-slate-950 disabled:opacity-40">كمل <ArrowLeft className="h-4 w-4" /></button>
          ) : (
            <button type="button" disabled={!canContinue || busy} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-6 py-2.5 text-sm font-black text-slate-950 disabled:opacity-40">{busy ? 'بنجهز بيزنسك…' : 'جهز حسابي'} <Sparkles className="h-4 w-4" /></button>
          )}
        </div>
      </div>
    </div>
  );
}
