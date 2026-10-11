import { getPool } from '@/lib/db';
import { listPlans } from '@/platform/commercial/planRepository';
import {
  DRVO_ANNUAL_FREE_MONTHS,
  DRVO_COMMERCIAL_ADDONS,
  DRVO_PLAN_PRICING,
  DRVO_PRICING_EFFECTIVE_FROM,
  annualSavings,
  formatEgp,
  monthlyEquivalentFromAnnual,
} from '@/platform/commercial/pricingCatalog';

export const dynamic = 'force-dynamic';

function billingLabel(billing: 'one_time' | 'monthly' | 'quote') {
  if (billing === 'one_time') return 'مرة واحدة';
  if (billing === 'monthly') return 'شهرياً';
  return 'سعر مخصص';
}

export default async function PlatformPricingPage() {
  const plans = (await listPlans(await getPool())).filter((p) => p.isPublic && p.isActive);
  const dbByCode = new Map(plans.map((p) => [p.planCode, p]));

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">الأسعار والباقات التجارية</h2>
        <p className="text-sm text-muted-foreground">
          عرض DRVOERP V1 المقترح للبيع — ساري من {DRVO_PRICING_EFFECTIVE_FROM}. التحصيل في V1 يتم يدوياً من فريق التشغيل.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {DRVO_PLAN_PRICING.map((offer) => {
          const plan = dbByCode.get(offer.planCode);
          return (
            <article
              key={offer.planCode}
              className={`relative rounded-2xl border p-5 ${offer.recommended ? 'border-primary bg-primary/5' : 'border-border'}`}
            >
              {offer.recommended && (
                <span className="absolute -top-3 right-4 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  الأكثر مناسبة
                </span>
              )}
              <div className="space-y-1">
                <h3 className="text-lg font-bold">{offer.nameAr}</h3>
                <p className="text-xs text-muted-foreground">{offer.audience}</p>
              </div>

              <div className="mt-4">
                <div className="text-3xl font-black">{formatEgp(offer.monthlyPrice)}</div>
                <div className="text-xs text-muted-foreground">شهرياً</div>
              </div>

              <div className="mt-3 rounded-xl bg-muted/50 p-3 text-sm">
                <div className="font-semibold">{formatEgp(offer.annualPrice)} / سنة</div>
                <div className="text-xs text-muted-foreground">
                  يعادل {formatEgp(monthlyEquivalentFromAnnual(offer))} شهرياً — وفر {formatEgp(annualSavings(offer))} ({DRVO_ANNUAL_FREE_MONTHS} شهر مجاناً)
                </div>
              </div>

              <p className="mt-4 text-sm">{offer.positioning}</p>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">الفروع</dt>
                  <dd className="font-semibold">{plan?.maxBranches ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">المستخدمون</dt>
                  <dd className="font-semibold">{plan?.maxUsers ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">التجربة المجانية</dt>
                  <dd className="font-semibold">{plan?.trialDays ?? 14} يوم</dd>
                </div>
              </dl>

              {!plan && (
                <p className="mt-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-500">
                  تحذير: الخطة غير موجودة أو غير مفعلة في قاعدة البيانات.
                </p>
              )}
            </article>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border p-5">
        <h3 className="font-bold">قاعدة الباقات</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Starter / Growth / Pro لا تقفل التطبيقات. نوع النشاط يحدد التطبيقات المناسبة، والباقات التجارية تحدد السعة فقط
          (الفروع والمستخدمين وفترة التجربة). ده يمنع إننا نبيع نفس النظام ناقص بشكل مصطنع.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-bold">خدمات وإضافات</h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {DRVO_COMMERCIAL_ADDONS.map((addon) => (
            <article key={addon.code} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <h4 className="font-semibold">{addon.nameAr}</h4>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${addon.availability === 'available' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                  {addon.availability === 'available' ? 'متاح' : 'قريباً'}
                </span>
              </div>
              <div className="mt-3 text-lg font-bold">
                {addon.price == null ? billingLabel(addon.billing) : formatEgp(addon.price)}
              </div>
              {addon.price != null && <div className="text-xs text-muted-foreground">{billingLabel(addon.billing)}</div>}
              <p className="mt-3 text-sm text-muted-foreground">{addon.description}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-muted/30 p-5 text-sm">
        <div className="font-semibold">ملاحظات البيع</div>
        <ul className="mt-2 list-disc space-y-1 pr-5 text-muted-foreground">
          <li>14 يوم تجربة مجانية بدون بوابة دفع في V1.</li>
          <li>الدفع السنوي = 10 شهور فقط، أي شهرين مجاناً.</li>
          <li>Growth هو العرض الافتراضي المقترح لمعظم الصالونات.</li>
          <li>WhatsApp + AI لا يتم بيعه حالياً لعميل جديد قبل جاهزية ربط قناة مستقلة لكل منشأة.</li>
        </ul>
      </div>
    </section>
  );
}
