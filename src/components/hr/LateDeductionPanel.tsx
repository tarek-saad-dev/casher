'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldCheck, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface LateConfig {
  enabled: boolean;
  activatedOn: string | null;
}

interface LateCase {
  caseId: number;
  empId: number;
  branchId: number;
  workDate: string;
  lateMinutes: number;
  deductionKind: string;
  status: string;
  dailyBasePay: number | null;
  amount: number | null;
  attendanceId: number | null;
}

export default function LateDeductionPanel() {
  const [config, setConfig] = useState<LateConfig | null>(null);
  const [cases, setCases] = useState<LateCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [cancelReasons, setCancelReasons] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cfgRes, casesRes] = await Promise.all([
        fetch('/api/admin/hr/late-deduction/config'),
        fetch('/api/admin/hr/late-deduction/cases'),
      ]);
      const cfgData = await cfgRes.json();
      const casesData = await casesRes.json();
      if (!cfgRes.ok) throw new Error(cfgData.error || 'تعذر تحميل الإعدادات');
      if (!casesRes.ok) throw new Error(casesData.error || 'تعذر تحميل الحالات');
      setConfig(cfgData.config);
      setCases(casesData.cases ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleEnabled(enabled: boolean) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/hr/late-deduction/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
      setConfig(data.config);
      setSuccess(
        enabled
          ? `تم تفعيل خصم التأخير التلقائي من ${data.config.activatedOn}`
          : 'تم إيقاف خصم التأخير التلقائي',
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  }

  async function applyPenalty(caseId: number) {
    const amount = Number(amounts[caseId]);
    if (!(amount > 0)) {
      setError('أدخل مبلغ خصم صالح');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/hr/late-deduction/cases/${caseId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الاعتماد');
      setSuccess(`تم اعتماد خصم ${amount} ج.م`);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل الاعتماد');
    } finally {
      setSaving(false);
    }
  }

  async function cancelCase(caseId: number) {
    const reason = (cancelReasons[caseId] || '').trim();
    if (!reason) {
      setError('سبب الإلغاء مطلوب');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/hr/late-deduction/cases/${caseId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الإلغاء');
      setSuccess('تم إلغاء الخصم مع سجل تدقيق');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل الإلغاء');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin ml-2" />
        جاري التحميل...
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              خصم التأخير التلقائي
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              ربع يوم (1–60 د) · نصف يوم (61–120 د) · أكثر من 120 د بمراجعة المدير.
              لا يُطبَّق بأثر رجعي قبل تاريخ التفعيل.
            </p>
            {config?.activatedOn && (
              <p className="text-xs text-muted-foreground mt-1">
                تاريخ التفعيل: {config.activatedOn}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label className="text-xs">مفعّل</Label>
            <Switch
              checked={Boolean(config?.enabled)}
              disabled={saving}
              onCheckedChange={(v) => void toggleEnabled(v)}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <div className="space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          حالات بانتظار قرار المدير ({cases.length})
        </h4>
        {cases.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">لا توجد حالات معلّقة</p>
        ) : (
          <div className="space-y-3">
            {cases.map((c) => (
              <div
                key={c.caseId}
                className="rounded-xl border border-border bg-card p-3 space-y-3"
              >
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>موظف #{c.empId}</span>
                  <span>{c.workDate}</span>
                  <span className="font-medium text-amber-700">{c.lateMinutes} د تأخير</span>
                  {c.dailyBasePay != null && (
                    <span className="text-muted-foreground">أساس يومي: {c.dailyBasePay}</span>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="مبلغ الخصم"
                    value={amounts[c.caseId] ?? ''}
                    onChange={(e) =>
                      setAmounts((prev) => ({ ...prev, [c.caseId]: e.target.value }))
                    }
                    dir="ltr"
                    className="font-mono sm:max-w-40"
                  />
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => void applyPenalty(c.caseId)}
                  >
                    اعتماد الخصم
                  </Button>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    placeholder="سبب الإلغاء"
                    value={cancelReasons[c.caseId] ?? ''}
                    onChange={(e) =>
                      setCancelReasons((prev) => ({ ...prev, [c.caseId]: e.target.value }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void cancelCase(c.caseId)}
                  >
                    <Ban className="w-3.5 h-3.5 ml-1" />
                    إلغاء
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
