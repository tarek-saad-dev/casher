'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { platformFetch } from '@/components/platform/platformFetch';

type RequestRow = {
  requestId: string; requestedPlanCode: string; billingCycle: 'monthly' | 'annual';
  quotedAmountEgp: number; status: string; createdAt: string;
};
type BillingPayload = {
  subscription: {
    planCode: string; status: string; revision: number;
    trialEndsAt: string | null; currentPeriodEndsAt: string | null;
  };
  requests: RequestRow[];
  commercialModel: 'modular_transition';
  newPaidRequestsEnabled: false;
  paymentMode: 'no_checkout';
  protectedTenant: boolean;
};

function money(value: number): string {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(value) + ' ج.م';
}
function date(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('ar-EG') : '—';
}
const STATUS: Record<string, string> = {
  trial: 'فترة تجريبية', active: 'نشط', past_due: 'متأخر السداد',
  suspended: 'موقوف', cancelled: 'ملغي', pending: 'بانتظار مراجعة الفريق',
  contacted: 'تم التواصل', rejected: 'مرفوض',
};

export default function TenantBillingClient() {
  const [data, setData] = useState<BillingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => setData(await platformFetch<BillingPayload>('/api/tenant/billing'));
  useEffect(() => {
    let active = true;
    platformFetch<BillingPayload>('/api/tenant/billing')
      .then((payload) => { if (active) setData(payload); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const current = data?.subscription;
  const mayManageApps = current?.status === 'active' || current?.status === 'trial';
  return <main dir="rtl" className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
    <header className="space-y-2">
      <Link href="/admin/tenant" className="text-xs text-muted-foreground hover:underline">إعدادات المنشأة</Link>
      <h1 className="text-2xl font-bold">الاشتراك والتكلفة</h1>
      <p className="text-sm text-muted-foreground">DRVO ERP بيدعم اختيار التطبيقات حسب احتياج نشاطك. أسعار الاشتراك الجديد لسه قيد الاعتماد.</p>
    </header>
    {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 p-4 text-sm text-rose-600">
      <AlertCircle className="h-4 w-4" /> {error}
      <button type="button" className="mr-auto underline" onClick={() => { setError(null); void load().catch((e: Error) => setError(e.message)); }}>إعادة المحاولة</button>
    </div>}
    {!data && !error && <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل الاشتراك...</div>}
    {data && <>
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">حالة الاشتراك الحالي</h2>
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /> محفوظ</span>
        </div>
        <p className="mt-3 text-lg font-bold">{STATUS[current?.status ?? ''] ?? current?.status}</p>
        <p className="mt-1 text-xs text-muted-foreground">رمز النظام السابق: {current?.planCode} — لا يمثل عرضًا جديدًا أو سعرًا جديدًا.</p>
        {current?.status === 'trial' && <p className="mt-2 text-sm">التجربة تنتهي: {date(current.trialEndsAt)}</p>}
        {current?.currentPeriodEndsAt && <p className="mt-2 text-sm">نهاية الفترة الحالية: {date(current.currentPeriodEndsAt)}</p>}
      </section>
      <section className="space-y-3 rounded-2xl border border-border p-5">
        <h2 className="text-lg font-bold">التطبيقات بدل الباقات الثابتة</h2>
        <p className="text-sm leading-7 text-muted-foreground">بنجهّز التسعير المرن للتطبيقات والفروع والخدمات الإضافية. مفيش سعر نهائي أو دفع إلكتروني متاح حاليًا، ومش هنحسب عليك أي تكلفة جديدة لمجرد تثبيت تطبيق أثناء المرحلة دي.</p>
        {mayManageApps ? <Link href="/admin/apps" className="inline-flex min-h-10 items-center rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted">إدارة تطبيقاتي</Link> :
          <p className="text-sm text-muted-foreground">إدارة التطبيقات التشغيلية تتطلب اشتراكًا ساريًا. سجل البيانات والطلبات القديمة ظاهر هنا حتى بعد انتهاء التجربة.</p>}
      </section>
      {data.protectedTenant && <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">حساب CUT الأساسي محمي من تغييرات الاشتراك.</p>}
      <section className="space-y-3 rounded-2xl border border-border p-5">
        <h2 className="flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4" /> الطلبات السابقة (النظام القديم)</h2>
        {!data.requests.length ? <p className="text-sm text-muted-foreground">لا توجد طلبات سابقة.</p> :
          <div className="space-y-2">{data.requests.map((r) =>
            <div key={r.requestId} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
              <span>طلب سابق: {r.requestedPlanCode} · {r.billingCycle === 'annual' ? 'سنوي' : 'شهري'} · {money(r.quotedAmountEgp)}</span>
              <span className="text-xs text-muted-foreground">{STATUS[r.status] ?? r.status} · {date(r.createdAt)}</span>
            </div>)}</div>}
      </section>
      <p className="text-xs leading-6 text-muted-foreground">طلبات الاشتراك القديمة لا تعتبر إثبات دفع. لا يتم تحصيل أو تفعيل اشتراك مدفوع من هذه الصفحة.</p>
    </>}
  </main>;
}
