'use client';

import { useState } from 'react';
import { platformFetch } from '@/components/platform/platformFetch';
import {
  SALON_RESEARCH_APP_OPTIONS,
  type ResearchScenario,
  type ScenarioCycle,
  type ScenarioModel,
} from '@/platform/commercial/modularPricingScenario';

const NAMES: Record<string, string> = {
  booking: 'الحجوزات', queue: 'الدور', pos: 'الكاشير',
  attendance: 'الحضور', payroll: 'الرواتب', treasury: 'تقارير الخزنة المتقدمة', reports: 'التقارير المتقدمة',
};
const money = (v: number) => new Intl.NumberFormat('ar-EG').format(v) + ' ج.م';

export default function ModularResearchClient() {
  const [selected, setSelected] = useState<string[]>(['booking', 'pos', 'queue']);
  const [branches, setBranches] = useState(1);
  const [model, setModel] = useState<ScenarioModel>('per_app');
  const [cycle, setCycle] = useState<ScenarioCycle>('monthly');
  const [result, setResult] = useState<ResearchScenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function preview() {
    setLoading(true); setError(null); setResult(null);
    try {
      const next = await platformFetch<ResearchScenario>('/api/admin/platform/modular-pricing-preview', {
        method: 'POST', body: JSON.stringify({ industry: 'salon', apps: selected, branches, cycle, model }),
      });
      if (next.mode !== 'research_only' || next.canCheckout !== false || next.canActivate !== false)
        throw Error('حالة المقارنة غير متوقعة');
      setResult(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر حساب المقارنة');
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">حاسبة نموذج التطبيقات — للإدارة فقط</h1>
        <p className="text-sm text-muted-foreground">قارن سيناريوهات التسعير من غير باقات Starter/Growth/Pro. الأرقام تجريبية وغير معتمدة للبيع أو التحصيل.</p>
      </header>
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <b>بحث داخلي فقط:</b> لا يوجد Checkout أو تفعيل اشتراك هنا. سعر كل تطبيق ورسوم الفرع الإضافي ما زالوا فرضيات قابلة للتعديل.
      </div>
      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-bold">التطبيقات</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {SALON_RESEARCH_APP_OPTIONS.map((app) => (
            <label key={app.code} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={selected.includes(app.code)} disabled={app.required}
                  onChange={(e) => { setResult(null); setSelected((old) => e.target.checked ? [...old, app.code] : old.filter((x) => x !== app.code)); }} />
                {NAMES[app.code]} {app.required ? '(أساسي للصالون)' : ''}
              </span>
              <span className="text-xs text-muted-foreground">{money(model === 'per_app' ? app.monthlyEgp : app.monthlyEgp * 0.8)} / شهر افتراضيًا</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="نموذج الحساب البحثي">
          {([
            {code:'per_app',name:'بدون رسم أساسي'},
            {code:'base_plus_apps',name:'رسم أساسي + تطبيقات بسعر أقل'},
          ] as const).map((option) => (
            <button key={option.code} type="button" aria-pressed={model === option.code}
              onClick={() => { setModel(option.code); setResult(null); }}
              className={'min-h-10 rounded-lg border px-3 py-2 text-xs ' +
                (model === option.code ? 'border-primary bg-primary/10 font-semibold' : 'border-border')}>
              {option.name}
            </button>
          ))}
        </div>
        {model === 'base_plus_apps' && <p className="text-xs text-muted-foreground">الفرضية دي فيها 149 ج.م رسوم منصة شهرية بالإضافة لتطبيقات أقل بـ20%. دي مقارنة داخلية فقط.</p>}
        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm">عدد الفروع
            <select className="rounded-lg border border-border bg-background p-2" value={branches}
              onChange={(e) => { setBranches(Number(e.target.value)); setResult(null); }}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option value={n} key={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">المدة
            <select className="rounded-lg border border-border bg-background p-2" value={cycle}
              onChange={(e) => { setCycle(e.target.value as ScenarioCycle); setResult(null); }}>
              <option value="monthly">شهري</option><option value="annual">سنوي (فرضية 10 شهور)</option>
            </select>
          </label>
        </div>
        <button type="button" disabled={loading} onClick={() => void preview()}
          className="min-h-11 rounded-xl bg-primary px-5 py-2 font-semibold text-primary-foreground disabled:opacity-50">
          {loading ? 'جاري الحساب…' : 'احسب السيناريو الداخلي'}
        </button>
      </section>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {result && <section className="space-y-3 rounded-2xl border border-border p-5">
        <h2 className="font-bold">تفصيل السيناريو (ليس عرض سعر)</h2>
        {result.lines.map((l) => <div key={l.code} className="flex justify-between gap-4 text-sm">
          <span>{l.label} {l.quantity > 1 ? '× ' + l.quantity : ''}</span><b>{money(l.monthlyEgp)} / شهر</b>
        </div>)}
        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">النموذج: {result.model === 'per_app' ? 'كل تطبيق منفصل' : 'رسوم أساسية وتطبيقات'} · إصدار {result.catalogVersion}</p>
          <p className="text-xs text-muted-foreground">متوسط الفرضية شهريًا: {money(result.monthlyEgp)}</p>
          <p className="mt-1 text-xl font-bold">الإجمالي الافتراضي للمدة: {money(result.illustrativePeriodEgp)}</p>
        </div>
        <p className="text-xs leading-6 text-muted-foreground">{result.note}</p>
      </section>}
    </div>
  );
}
