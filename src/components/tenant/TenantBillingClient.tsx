'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, Check, CreditCard, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { platformFetch } from '@/components/platform/platformFetch';
import type { BillingCycle, PlanRequestStatus } from '@/platform/commercial/planRequestPolicy';

type Offer = { planCode: string; nameAr: string; monthlyPrice: number; annualPrice: number;
  maxBranches: number | null; maxUsers: number | null; positioning: string; audience: string; recommended?: boolean };
type RequestRow = { requestId: string; requestedPlanCode: string; billingCycle: BillingCycle;
  quotedAmountEgp: number; status: PlanRequestStatus; createdAt: string };
type BillingPayload = {
  subscription: { planCode: string; status: string; revision: number; trialEndsAt: string | null; currentPeriodEndsAt: string | null };
  plans: Offer[];
  requests: RequestRow[];
  paymentMode: 'manual_review_only';
  protectedTenant: boolean;
};

function money(value: number): string { return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(value) + ' ج.م'; }
function date(value: string | null): string { return value ? new Date(value).toLocaleDateString('ar-EG') : '—'; }
const STATUS: Record<string, string> = {
  trial: 'فترة تجريبية', active: 'نشط', past_due: 'متأخر السداد', suspended: 'موقوف', cancelled: 'ملغي',
  pending: 'بانتظار مراجعة الفريق', contacted: 'تم التواصل', rejected: 'مرفوض', cancelled_request: 'ملغي',
};
export default function TenantBillingClient() {
  const [data, setData] = useState<BillingPayload | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    const response = await platformFetch<BillingPayload>('/api/tenant/billing');
    setData(response);
  };
  useEffect(() => {
    let active = true;
    platformFetch<BillingPayload>('/api/tenant/billing')
      .then((response) => { if (active) setData(response); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const pending = useMemo(() => data?.requests.find((r) => r.status === 'pending'), [data]);
  const current = data?.subscription;

  const submit = async () => {
    if (!data || !selected || pending || saving) return;
    setSaving(true);
    setError(null); setSuccess(null);
    try {
      const response = await platformFetch<{ paid: false; subscriptionChanged: false }>('/api/tenant/billing', {
        method: 'POST',
        body: JSON.stringify({ planCode: selected, billingCycle: cycle, expectedRevision: data.subscription.revision }),
      });
      if (response.paid !== false || response.subscriptionChanged !== false) throw new Error('حالة طلب الاشتراك غير متوقعة');
      await load();
      setSelected(null);
      setSuccess('تم تسجيل طلبك للمراجعة. اشتراكك الحالي لم يتغير ولم يتم تحصيل أي مبلغ.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إرسال الطلب');
      try { await load(); } catch { /* keep the last response */ }
    } finally { setSaving(false); }
  };

  return <main dir="rtl" className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <header className="space-y-2">
      <Link href="/admin/tenant" className="text-xs text-muted-foreground hover:underline">إعدادات المنشأة</Link>
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">الباقات والاشتراك</h1>
      <p className="text-sm text-muted-foreground">اختار الخطة المناسبة لحجم شغلك. التطبيقات بتفضل زي ما هي مهما غيرت الباقة.</p>
    </header>
    {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-600">
      <AlertCircle className="h-4 w-4" /> {error}
      <button className="mr-auto underline" onClick={() => { setError(null); void load().catch((e: Error) => setError(e.message)); }}>إعادة المحاولة</button>
    </div>}
    {success && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-600">{success}</div>}
    {!data && !error && <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> بنحمّل اشتراكك…</div>}
    {data && <>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5">
        <div>
          <p className="text-xs text-muted-foreground">باقتك الحالية</p>
          <h2 className="mt-1 text-xl font-bold">{current?.planCode.toUpperCase()} <span className="text-sm font-normal text-muted-foreground">• {STATUS[current?.status ?? ''] ?? current?.status}</span></h2>
          {current?.status === 'trial' && <p className="mt-2 text-xs text-muted-foreground">تنتهي التجربة: {date(current.trialEndsAt)}</p>}
          {current?.currentPeriodEndsAt && <p className="mt-2 text-xs text-muted-foreground">نهاية الفترة الحالية: {date(current.currentPeriodEndsAt)}</p>}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4" /> إدارة الاشتراك بشكل آمن
        </span>
      </section>

      {pending && <div role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <h2 className="font-semibold">عندك طلب تحت المراجعة</h2>
        <p className="mt-1 text-sm text-muted-foreground">طلب {pending.requestedPlanCode.toUpperCase()} ({pending.billingCycle === 'annual' ? 'سنوي' : 'شهري'}) بقيمة {money(pending.quotedAmountEgp)}. الطلب مش معناه إن الدفع تم أو إن الباقة اتغيرت.</p>
      </div>}
      {data.protectedTenant && <div className="rounded-xl border border-border p-3 text-sm text-muted-foreground">حساب المنصة الرئيسي محمي، واشتراكه تحت إدارة المنصة فقط.</div>}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">اختار الباقة</h2>
          <div role="group" aria-label="مدة الاشتراك" className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">
            {(['monthly','annual'] as const).map((value) => <button
              key={value} type="button" aria-pressed={cycle === value} onClick={() => { setCycle(value); setSelected(null); }}
              className={'rounded-lg px-4 py-2 text-sm font-medium ' + (cycle === value ? 'bg-background shadow-sm' : 'text-muted-foreground')}
            >{value === 'monthly' ? 'شهري' : 'سنوي — وفّر شهرين'}</button>)}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {data.plans.map((offer) => <article key={offer.planCode} className={'flex flex-col justify-between gap-5 rounded-2xl border p-5 ' +
            (selected === offer.planCode ? 'border-primary bg-primary/5' : 'border-border bg-card')}>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">{offer.nameAr}</h3>
                {offer.recommended && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">الأكثر مناسبة</span>}
              </div>
              <p className="text-sm text-muted-foreground">{offer.audience}</p>
              <div className="text-3xl font-black">{money(cycle === 'annual' ? offer.annualPrice : offer.monthlyPrice)}</div>
              <div className="text-xs text-muted-foreground">{cycle === 'annual' ? 'إجمالي السنة، بدون رسوم إضافية داخل الطلب' : 'إجمالي الشهر'}</div>
              <p className="text-sm">{offer.positioning}</p>
              <p className="text-xs text-muted-foreground">الفروع: {offer.maxBranches ?? 'غير محدود'} · المستخدمون: {offer.maxUsers ?? 'غير محدود'}</p>
            </div>
            <button type="button" disabled={!!pending || data.protectedTenant || saving}
              onClick={() => setSelected(selected === offer.planCode ? null : offer.planCode)}
              className="min-h-11 rounded-xl border border-primary/30 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50">
              {selected === offer.planCode ? <span className="inline-flex items-center gap-2"><Check className="h-4 w-4" /> تم الاختيار</span> : 'اختيار الباقة'}
            </button>
          </article>)}
        </div>
      </section>
      {selected && !pending && !data.protectedTenant && <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/30 p-5">
        <div>
          <h2 className="font-bold">تأكيد طلب {selected.toUpperCase()}</h2>
          <p className="mt-1 text-xs text-muted-foreground">هنسجل طلبك، وفريق المنصة هيراجعه معاك. ده مش دفع إلكتروني، ومش هيغير اشتراكك تلقائيًا.</p>
        </div>
        <button type="button" disabled={saving} onClick={() => void submit()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          إرسال طلب الاشتراك
        </button>
      </section>}
      <section className="space-y-3 rounded-2xl border border-border p-5">
        <h2 className="flex items-center gap-2 font-bold"><CalendarDays className="h-4 w-4" /> آخر طلبات الاشتراك</h2>
        {!data.requests.length ? <p className="text-sm text-muted-foreground">مفيش طلبات سابقة.</p> :
          <div className="space-y-2">
            {data.requests.map((r) => <div key={r.requestId} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
              <div><b>{r.requestedPlanCode.toUpperCase()}</b> · {r.billingCycle === 'annual' ? 'سنوي' : 'شهري'} · {money(r.quotedAmountEgp)}</div>
              <span className="text-xs text-muted-foreground">{STATUS[r.status] ?? r.status} · {date(r.createdAt)}</span>
            </div>)}
          </div>}
      </section>
      <p className="text-xs leading-6 text-muted-foreground">الدفع الإلكتروني والتجديد التلقائي مش متاحين في المرحلة دي. إرسال الطلب للتواصل والمراجعة فقط، ولا يوجد تحصيل أو فاتورة مدفوعة أو تفعيل تلقائي.</p>
    </>}
  </main>;
}
