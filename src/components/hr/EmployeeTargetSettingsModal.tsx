'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Target, Trash2, Eye } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

export type TargetInputBasis = 'monthly' | 'daily';

export interface TargetTierDraft {
  key: string;
  inputStartAmount: string;
  ratePercent: string;
}

export interface EmployeeTargetSettingsModalProps {
  open: boolean;
  onClose: () => void;
  empId: number;
  empName: string;
  onSuccess?: (message: string) => void;
  onSaved?: () => void;
}

interface PreviewBreakdownRow {
  from: number;
  to: number | null;
  eligibleAmount: number;
  ratePercent: number;
  targetAmount: number;
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const fmtAmount = (n: number) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 6 }).format(n);

/** Cairo calendar today YYYY-MM-DD */
export function cairoTodayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

/** Current month covers from day 1 through last day (for display + EffectiveFrom). */
export function currentMonthCoverage(todayIso = cairoTodayIso()): {
  effectiveFrom: string;
  monthEnd: string;
  year: number;
  month: number;
} {
  const [yStr, mStr] = todayIso.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const effectiveFrom = `${yStr}-${mStr}-01`;
  // Date.UTC month is 0-based; day 0 of next month = last day of `month`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;
  return { effectiveFrom, monthEnd, year, month };
}

function newTierKey(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toDailyDisplay(
  inputStart: string,
  basis: TargetInputBasis,
  conversionDays: number,
): string {
  const n = Number(inputStart);
  if (!Number.isFinite(n) || conversionDays < 1) return '—';
  const daily = basis === 'monthly' ? n / conversionDays : n;
  return fmtAmount(Number(daily.toFixed(6)));
}

export function toMonthlyEquivalentDisplay(
  inputStart: string,
  basis: TargetInputBasis,
  conversionDays: number,
): string {
  const n = Number(inputStart);
  if (!Number.isFinite(n) || conversionDays < 1) return '—';
  const daily = basis === 'monthly' ? n / conversionDays : n;
  return fmtAmount(Number((daily * conversionDays).toFixed(6)));
}

export function buildTierInterpretation(
  tiers: Array<{ inputStartAmount: string; ratePercent: string }>,
  _basis: TargetInputBasis = 'monthly',
  _conversionDays = 26,
): string[] {
  if (tiers.length === 0) {
    return ['لا توجد شرائح — لن يُحسب تارجت.'];
  }

  const starts = tiers.map((t) => ({
    monthly: Number(t.inputStartAmount),
    rate: t.ratePercent,
  }));

  const lines: string[] = [];
  const first = starts[0];
  if (first && Number.isFinite(first.monthly)) {
    lines.push(`أقل من ${fmtAmount(first.monthly)} تراكمي: بدون تارجت`);
  }

  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i];
    const next = starts[i + 1];
    if (!cur || !Number.isFinite(cur.monthly)) continue;
    if (next && Number.isFinite(next.monthly)) {
      const width = next.monthly - cur.monthly;
      const fullBand = Number.isFinite(width) && width > 0
        ? Number((width * Number(cur.rate) / 100).toFixed(2))
        : null;
      lines.push(
        fullBand != null && Number.isFinite(Number(cur.rate))
          ? `من ${fmtAmount(cur.monthly)} لـ ${fmtAmount(next.monthly)} كامل ← ${fmtMoney(fullBand)} (${cur.rate}%)`
          : `من ${fmtAmount(cur.monthly)} إلى ${fmtAmount(next.monthly)}: ${cur.rate}%`,
      );
    } else {
      lines.push(
        `من ${fmtAmount(cur.monthly)} فأعلى ← ${cur.rate}% على الزيادة`,
      );
    }
  }
  return lines;
}

/** Suggest next tier start = last start + 10000 (or 10000 if first). */
export function suggestNextTierStart(tiers: Array<{ inputStartAmount: string }>): string {
  if (tiers.length === 0) return '10000';
  const last = Number(tiers[tiers.length - 1]?.inputStartAmount);
  if (!Number.isFinite(last) || last < 0) return '';
  return String(last + 10000);
}

function tierBandMeta(
  tiers: TargetTierDraft[],
  index: number,
): { from: number | null; to: number | null; width: number | null; fullBandTarget: number | null } {
  const from = Number(tiers[index]?.inputStartAmount);
  const toRaw = tiers[index + 1] ? Number(tiers[index + 1]!.inputStartAmount) : null;
  const rate = Number(tiers[index]?.ratePercent);
  if (!Number.isFinite(from)) {
    return { from: null, to: null, width: null, fullBandTarget: null };
  }
  const to = toRaw != null && Number.isFinite(toRaw) ? toRaw : null;
  const width = to != null && to > from ? to - from : null;
  const fullBandTarget =
    width != null && Number.isFinite(rate)
      ? Number((width * rate / 100).toFixed(2))
      : null;
  return { from, to, width, fullBandTarget };
}

function validateClientForm(params: {
  isEnabled: boolean;
  tiers: TargetTierDraft[];
}): string | null {
  const { isEnabled, tiers } = params;
  if (isEnabled && tiers.length === 0) {
    return 'التارجت المفعّل يحتاج شريحة واحدة على الأقل';
  }
  const starts: number[] = [];
  for (const tier of tiers) {
    const start = Number(tier.inputStartAmount);
    const rate = Number(tier.ratePercent);
    if (!Number.isFinite(start) || start < 0) {
      return 'بداية الشريحة لا يمكن أن تكون سالبة';
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return 'النسبة من 0 إلى 100';
    }
    starts.push(start);
  }
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] < starts[i - 1]) return 'يجب ترتيب الشرائح تصاعديًا';
    if (starts[i] === starts[i - 1]) return 'لا يمكن تكرار بداية شريحتين';
  }
  return null;
}

export default function EmployeeTargetSettingsModal({
  open,
  onClose,
  empId,
  empName,
  onSuccess,
  onSaved,
}: EmployeeTargetSettingsModalProps) {
  const month = useMemo(() => currentMonthCoverage(), []);

  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [isEnabled, setIsEnabled] = useState(false);
  const [tiers, setTiers] = useState<TargetTierDraft[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [sampleDailySales, setSampleDailySales] = useState('40000');
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [previewBreakdown, setPreviewBreakdown] = useState<PreviewBreakdownRow[]>([]);

  const interpretation = useMemo(
    () => buildTierInterpretation(tiers, 'monthly', 26),
    [tiers],
  );

  const busy = saving || loading;

  const resetPreview = () => {
    setPreviewTotal(null);
    setPreviewBreakdown([]);
  };

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/admin/employees/${empId}/target-settings`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل إعدادات التارجت');

      const source = data.effectivePlan ?? data.latestPlan;
      if (source) {
        setIsEnabled(Boolean(source.isEnabled));
        setTiers(
          (source.tiers ?? []).map((t: { inputStartAmount: number; ratePercent: number }) => ({
            key: newTierKey(),
            inputStartAmount: String(t.inputStartAmount),
            ratePercent: String(t.ratePercent),
          })),
        );
      } else {
        setIsEnabled(false);
        setTiers([]);
      }
      resetPreview();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  }, [empId]);

  useEffect(() => {
    if (open) void loadSettings();
  }, [open, loadSettings]);

  const save = async () => {
    if (busy) return;
    setError('');
    setSuccessMsg('');

    const v = validateClientForm({ isEnabled, tiers });
    if (v) {
      setError(v);
      return;
    }

    // Always bind to current month start so mid-month setup covers day 1 → month end.
    const { effectiveFrom } = currentMonthCoverage();

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/employees/${empId}/target-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isEnabled,
          inputBasis: 'monthly',
          conversionDays: 26,
          effectiveFrom,
          notes: null,
          tiers: tiers.map((t) => ({
            inputStartAmount: Number(t.inputStartAmount),
            ratePercent: Number(t.ratePercent),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');

      const msg = isEnabled ? 'تم حفظ وتشغيل التارجت لهذا الشهر' : 'تم حفظ التارجت متوقفًا لهذا الشهر';
      setSuccessMsg(msg);
      onSuccess?.(msg);
      onSaved?.();
      await loadSettings();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const addTier = () => {
    setTiers((prev) => [
      ...prev,
      {
        key: newTierKey(),
        inputStartAmount: suggestNextTierStart(prev),
        ratePercent: prev.length === 0 ? '10' : '20',
      },
    ]);
    resetPreview();
  };

  const removeTier = (key: string) => {
    setTiers((prev) => prev.filter((t) => t.key !== key));
    resetPreview();
  };

  const updateTier = (key: string, field: 'inputStartAmount' | 'ratePercent', value: string) => {
    setTiers((prev) => prev.map((t) => (t.key === key ? { ...t, [field]: value } : t)));
    resetPreview();
  };

  const runPreview = async () => {
    setError('');
    if (tiers.length === 0) {
      setError('أضف شريحة واحدة على الأقل للمعاينة');
      return;
    }
    const v = validateClientForm({ isEnabled: true, tiers });
    if (v) {
      setError(v);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/admin/employees/${empId}/target-settings/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputBasis: 'monthly',
          conversionDays: 26,
          sampleDailySales: Number(sampleDailySales),
          tiers: tiers.map((t) => ({
            inputStartAmount: Number(t.inputStartAmount),
            ratePercent: Number(t.ratePercent),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل المعاينة');
      setPreviewTotal(Number(data.preview?.targetAmount ?? 0));
      setPreviewBreakdown(Array.isArray(data.preview?.breakdown) ? data.preview.breakdown : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل المعاينة');
    } finally {
      setPreviewLoading(false);
    }
  };

  const statusTone = isEnabled
    ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
    : 'bg-amber-500/10 text-amber-700 border-amber-500/30';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" />
              تارجت — {empName}
            </span>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusTone}`}>
              {isEnabled ? 'سيُحفظ مفعّلًا' : 'سيُحفظ متوقفًا'}
            </span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin ml-2" />
            جاري التحميل...
          </div>
        ) : (
          <div className="space-y-5 pt-1">
            {error && (
              <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="p-3 rounded-lg border border-success/30 bg-success/5 text-sm text-success">
                {successMsg}
              </div>
            )}

            {/* Enable + one save */}
            <section className="flex items-center justify-between gap-3 rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-semibold">تشغيل التارجت</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  اضبط الشرائح ثم اضغط «حفظ» مرة واحدة
                </p>
              </div>
              <Switch
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
                disabled={busy}
                data-testid="enabled-switch"
              />
            </section>

            <div className="rounded-lg border border-border bg-surface-muted/20 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
              <p>
                يسري على <span className="font-medium text-foreground">الشهر الحالي بالكامل</span>
                {' '}من {month.effectiveFrom} إلى {month.monthEnd}
                {' '}— حتى لو الحفظ اليوم منتصف الشهر.
              </p>
              <p>
                الحسبة على <span className="font-medium text-foreground">إجمالي مبيعات الشهر حتى اليوم</span>
                {' '}(شرائح شهرية) — تحت أول شريحة = بدون تارجت.
              </p>
            </div>

            <section className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <h3 className="text-sm font-semibold">الشرائح الشهرية</h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    كل شريحة لها حد بداية ونسبة. تحت أول حد = بدون تارجت.
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1 shrink-0" onClick={addTier} disabled={busy}>
                  <Plus className="w-3.5 h-3.5" />
                  إضافة شريحة
                </Button>
              </div>

              {tiers.length === 0 ? (
                <div className="text-sm border border-dashed border-border rounded-xl p-5 space-y-2 text-center">
                  <p className="text-muted-foreground">لا توجد شرائح — اضغط «إضافة شريحة»</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    مثال: من ١٠٬٠٠٠ بنسبة ١٠٪ · من ٣٠٬٠٠٠ بنسبة ٢٠٪ · من ٤٠٬٠٠٠ بنسبة ٣٠٪
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tiers.map((tier, idx) => {
                    const band = tierBandMeta(tiers, idx);
                    const nextExists = idx + 1 < tiers.length;
                    return (
                      <div
                        key={tier.key}
                        className="rounded-xl border border-border bg-surface-muted/10 overflow-hidden"
                        data-testid={`tier-card-${idx}`}
                      >
                        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/70 bg-surface-muted/30">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-primary/10 text-primary text-xs font-bold px-1.5">
                              {idx + 1}
                            </span>
                            <span className="text-xs font-medium text-foreground truncate">
                              {idx === 0 ? 'الشريحة الأولى (أقل حد للتارجت)' : `الشريحة رقم ${idx + 1}`}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0 border-destructive/30 text-destructive shrink-0"
                            onClick={() => removeTier(tier.key)}
                            disabled={busy}
                            aria-label={`حذف الشريحة ${idx + 1}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>

                        <div className="p-3 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-[11px] font-medium text-foreground">
                                تبدأ عندما يصل التراكمي إلى
                              </label>
                              <Input
                                type="number"
                                min={0}
                                className="h-10 text-base"
                                placeholder="مثال: 40000"
                                value={tier.inputStartAmount}
                                onChange={(e) => updateTier(tier.key, 'inputStartAmount', e.target.value)}
                                disabled={busy}
                              />
                              <p className="text-[10px] text-muted-foreground">إجمالي مبيعات الشهر</p>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[11px] font-medium text-muted-foreground">
                                تنتهي عند
                              </label>
                              <Input
                                readOnly
                                className="h-10 bg-surface-muted/50 text-base"
                                value={
                                  nextExists && band.to != null
                                    ? fmtAmount(band.to)
                                    : 'فأعلى'
                                }
                              />
                              <p className="text-[10px] text-muted-foreground">
                                {nextExists ? 'من الشريحة التالية' : 'آخر شريحة'}
                              </p>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[11px] font-medium text-foreground">
                                النسبة ٪
                              </label>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                className="h-10 text-base"
                                placeholder="مثال: 30"
                                value={tier.ratePercent}
                                onChange={(e) => updateTier(tier.key, 'ratePercent', e.target.value)}
                                disabled={busy}
                              />
                              <p className="text-[10px] text-muted-foreground">على جزء الشريحة</p>
                            </div>
                          </div>

                          <div className="rounded-lg border border-border/80 bg-background px-3 py-2 text-[11px] leading-relaxed">
                            {band.from != null ? (
                              band.width != null && band.fullBandTarget != null ? (
                                <p className="text-foreground">
                                  لو جاب من {fmtAmount(band.from)} لـ {fmtAmount(band.to!)} كامل
                                  {' '}({fmtAmount(band.width)} ج.م) ← التارجت ={' '}
                                  <span className="font-semibold text-primary">{fmtMoney(band.fullBandTarget)}</span>
                                  {' '}({tier.ratePercent}%)
                                </p>
                              ) : (
                                <p className="text-foreground">
                                  من {fmtAmount(band.from)} فأعلى ← كل مبلغ زيادة بنسبة {tier.ratePercent || '—'}%
                                </p>
                              )
                            ) : (
                              <p className="text-muted-foreground">اكتب رقم البداية عشان يظهر الحساب.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {tiers.length > 0 && (
                <div className="rounded-xl border border-border px-3 py-2.5 space-y-1.5">
                  <p className="text-xs font-semibold text-foreground">ملخص الاتفاق</p>
                  <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pr-4">
                    {interpretation.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium"
                onClick={() => setShowPreview((v) => !v)}
              >
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />
                  معاينة
                </span>
                <span className="text-xs text-muted-foreground">{showPreview ? 'إخفاء' : 'إظهار'}</span>
              </button>
              {showPreview && (
                <div className="border-t border-border p-3 space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1 flex-1 min-w-[140px]">
                      <label className="text-[11px] text-muted-foreground">مبيعات الشهر حتى اليوم (عينة)</label>
                      <Input
                        type="number"
                        className="h-9"
                        value={sampleDailySales}
                        onChange={(e) => setSampleDailySales(e.target.value)}
                        disabled={busy || previewLoading}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      onClick={() => void runPreview()}
                      disabled={busy || previewLoading}
                    >
                      {previewLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      احسب
                    </Button>
                  </div>
                  {previewTotal != null && (
                    <div className="space-y-2">
                      <p className="text-sm">
                        تارجت الشهر (حتى الآن):{' '}
                        <span className="font-semibold text-primary">{fmtMoney(previewTotal)}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        الناتج = الجزء اللي دخل كل شريحة × نسبتها. مثال: ٤٥٬٠٠٠ جوه ٤٠→٥٠ = ٥٬٠٠٠ × ٣٠٪ = ١٬٥٠٠
                        (٣٬٠٠٠ لو وصل ٥٠٬٠٠٠ كامل).
                      </p>
                      <div className="rounded-lg border border-border overflow-hidden">
                        <table className="w-full text-[11px]">
                          <thead className="bg-surface-muted/40 text-muted-foreground">
                            <tr>
                              <th className="text-right font-medium px-2 py-1.5">الشريحة</th>
                              <th className="text-right font-medium px-2 py-1.5">داخل الشريحة</th>
                              <th className="text-right font-medium px-2 py-1.5">٪</th>
                              <th className="text-right font-medium px-2 py-1.5">الناتج</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewBreakdown.map((row, i) => (
                              <tr key={`${row.from}-${i}`} className="border-t border-border">
                                <td className="px-2 py-1.5 text-muted-foreground">
                                  {fmtAmount(row.from)}
                                  {row.to != null ? ` → ${fmtAmount(row.to)}` : ' فأعلى'}
                                </td>
                                <td className="px-2 py-1.5 font-medium text-foreground">
                                  {fmtMoney(row.eligibleAmount)}
                                </td>
                                <td className="px-2 py-1.5">{row.ratePercent}%</td>
                                <td className="px-2 py-1.5 font-semibold text-primary">
                                  {fmtMoney(row.targetAmount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                إغلاق
              </Button>
              <Button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                className="gap-1 min-w-[140px]"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                حفظ
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
