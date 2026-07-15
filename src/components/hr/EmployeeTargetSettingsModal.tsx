'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Target, Trash2, Eye } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

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
  basis: TargetInputBasis,
  conversionDays: number,
): string[] {
  if (tiers.length === 0) {
    return ['لا توجد شرائح — لن يُحسب تارجت.'];
  }

  const starts = tiers.map((t) => {
    const input = Number(t.inputStartAmount);
    const daily = basis === 'monthly' ? input / conversionDays : input;
    return {
      daily: Number.isFinite(daily) ? daily : NaN,
      rate: t.ratePercent,
    };
  });

  const lines: string[] = [];
  const first = starts[0];
  if (first && Number.isFinite(first.daily)) {
    lines.push(`أقل من ${fmtAmount(first.daily)} يوميًا: بدون تارجت`);
  }

  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i];
    const next = starts[i + 1];
    if (!cur || !Number.isFinite(cur.daily)) continue;
    if (next && Number.isFinite(next.daily)) {
      lines.push(
        `من ${fmtAmount(cur.daily)} إلى ${fmtAmount(next.daily)}: نسبة ${cur.rate}% على الجزء داخل الشريحة`,
      );
    } else {
      lines.push(
        `من ${fmtAmount(cur.daily)} فأعلى: نسبة ${cur.rate}% على الجزء الزائد`,
      );
    }
  }
  return lines;
}

function validateClientForm(params: {
  isEnabled: boolean;
  conversionDays: number;
  tiers: TargetTierDraft[];
}): string | null {
  const { isEnabled, conversionDays, tiers } = params;
  if (!Number.isInteger(conversionDays) || conversionDays < 1 || conversionDays > 31) {
    return 'عدد أيام التحويل من 1 إلى 31';
  }
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
  const [inputBasis, setInputBasis] = useState<TargetInputBasis>('monthly');
  const [conversionDays, setConversionDays] = useState(26);
  const [tiers, setTiers] = useState<TargetTierDraft[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [sampleDailySales, setSampleDailySales] = useState('1500');
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [previewBreakdown, setPreviewBreakdown] = useState<PreviewBreakdownRow[]>([]);

  const interpretation = useMemo(
    () => buildTierInterpretation(tiers, inputBasis, conversionDays),
    [tiers, inputBasis, conversionDays],
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
        setInputBasis(source.inputBasis === 'daily' ? 'daily' : 'monthly');
        setConversionDays(Number(source.conversionDays) || 26);
        setTiers(
          (source.tiers ?? []).map((t: { inputStartAmount: number; ratePercent: number }) => ({
            key: newTierKey(),
            inputStartAmount: String(t.inputStartAmount),
            ratePercent: String(t.ratePercent),
          })),
        );
      } else {
        setIsEnabled(false);
        setInputBasis('monthly');
        setConversionDays(26);
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

    const v = validateClientForm({ isEnabled, conversionDays, tiers });
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
          inputBasis,
          conversionDays,
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
      { key: newTierKey(), inputStartAmount: prev.length === 0 ? '0' : '', ratePercent: '20' },
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
    const v = validateClientForm({ isEnabled: true, conversionDays, tiers });
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
          inputBasis,
          conversionDays,
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
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

            <div className="rounded-lg border border-border bg-surface-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
              يسري على <span className="font-medium text-foreground">الشهر الحالي بالكامل</span>
              {' '}من {month.effectiveFrom} إلى {month.monthEnd}
              {' '}— حتى لو الحفظ اليوم منتصف الشهر.
            </div>

            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">إدخال الحدود</label>
                <Select
                  value={inputBasis}
                  onValueChange={(v) => {
                    setInputBasis(v as TargetInputBasis);
                    resetPreview();
                  }}
                  disabled={busy}
                >
                  <SelectTrigger className="text-right h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">شهري</SelectItem>
                    <SelectItem value="daily">يومي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {inputBasis === 'monthly' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">أيام التحويل</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    className="h-9"
                    value={conversionDays}
                    onChange={(e) => {
                      setConversionDays(Number(e.target.value));
                      resetPreview();
                    }}
                    disabled={busy}
                  />
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">الشرائح</h3>
                  <p className="text-[11px] text-muted-foreground">شريحة واحدة = ثابت · أكثر = متغير</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={addTier} disabled={busy}>
                  <Plus className="w-3.5 h-3.5" />
                  إضافة شريحة
                </Button>
              </div>

              {tiers.length === 0 ? (
                <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-5 text-center">
                  لا توجد شرائح — اضغط «إضافة شريحة»
                </div>
              ) : (
                <div className="space-y-2">
                  {tiers.map((tier, idx) => (
                    <div
                      key={tier.key}
                      className="grid grid-cols-12 gap-2 items-end rounded-xl border border-border p-3"
                    >
                      <div className="col-span-5 sm:col-span-3 space-y-1">
                        <label className="text-[11px] text-muted-foreground">البداية</label>
                        <Input
                          type="number"
                          className="h-9"
                          value={tier.inputStartAmount}
                          onChange={(e) => updateTier(tier.key, 'inputStartAmount', e.target.value)}
                          disabled={busy}
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2 space-y-1">
                        <label className="text-[11px] text-muted-foreground">٪</label>
                        <Input
                          type="number"
                          className="h-9"
                          value={tier.ratePercent}
                          onChange={(e) => updateTier(tier.key, 'ratePercent', e.target.value)}
                          disabled={busy}
                        />
                      </div>
                      <div className="col-span-7 sm:col-span-3 space-y-1">
                        <label className="text-[11px] text-muted-foreground">يوميًا</label>
                        <Input
                          readOnly
                          className="h-9 bg-surface-muted/40"
                          value={toDailyDisplay(tier.inputStartAmount, inputBasis, conversionDays)}
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-3 space-y-1">
                        <label className="text-[11px] text-muted-foreground">شهري ≈</label>
                        <Input
                          readOnly
                          className="h-9 bg-surface-muted/40"
                          value={toMonthlyEquivalentDisplay(tier.inputStartAmount, inputBasis, conversionDays)}
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 w-9 p-0 border-destructive/30 text-destructive"
                          onClick={() => removeTier(tier.key)}
                          disabled={busy}
                          aria-label={`حذف الشريحة ${idx + 1}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {tiers.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-1 list-disc pr-4">
                  {interpretation.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
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
                      <label className="text-[11px] text-muted-foreground">مبيعات يوم (عينة)</label>
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
                    <div className="space-y-1">
                      <p className="text-sm">
                        النتيجة:{' '}
                        <span className="font-semibold text-primary">{fmtMoney(previewTotal)}</span>
                      </p>
                      {previewBreakdown.map((row, i) => (
                        <div key={`${row.from}-${i}`} className="text-xs text-muted-foreground">
                          من {fmtAmount(row.from)}
                          {row.to != null ? ` إلى ${fmtAmount(row.to)}` : ' فأعلى'}
                          {' · '}{row.ratePercent}% → {fmtAmount(row.targetAmount)}
                        </div>
                      ))}
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
