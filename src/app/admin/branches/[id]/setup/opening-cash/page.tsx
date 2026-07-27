'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function OpeningCashSetupPage() {
  const params = useParams<{ id: string }>();
  const branchId = params.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [decision, setDecision] = useState<'ZERO' | 'AMOUNT' | null>(null);
  const [confirmZero, setConfirmZero] = useState(false);
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }),
  );
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}/setup/opening-cash`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التحميل');
      setResolved(!!data.resolved);
      setDecision(data.decision);
      if (data.amount != null) setAmount(String(data.amount));
      if (data.effectiveDate) setEffectiveDate(String(data.effectiveDate).slice(0, 10));
      if (data.reason) setReason(data.reason);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (mode: 'ZERO' | 'AMOUNT') => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body =
        mode === 'ZERO'
          ? { decision: 'ZERO', confirmZero }
          : { decision: 'AMOUNT', amount: Number(amount), effectiveDate, reason };
      const res = await fetch(`/api/admin/branches/${branchId}/setup/opening-cash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
      setMessage(data.blockerCleared ? 'تم حفظ القرار وتصفية مانع الخزنة' : 'تم الحفظ');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6" dir="rtl">
      <Link href={`/admin/branches/${branchId}/setup`} className="text-sm text-muted-foreground">
        ← معالج الإعداد
      </Link>
      <PageHeader
        title="الخزنة الافتتاحية"
        description="قرار صريح لرصيد بدء فرع كامب شيزار — لا يُنسخ من جليم"
      />

      {loading ? (
        <Loader2 className="mt-6 size-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="mt-6 space-y-6">
          {resolved && (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-3 text-sm text-emerald-200">
              تم اعتماد القرار: {decision === 'ZERO' ? 'رصيد صفر' : `مبلغ ${amount}`}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">
              {message}
            </div>
          )}

          <section className="rounded-xl border border-border/70 bg-card/70 p-4 space-y-3">
            <h3 className="font-semibold">أ. بدء الخزنة بصفر</h3>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmZero}
                onChange={(e) => setConfirmZero(e.target.checked)}
                className="mt-1"
              />
              <span>أؤكد أن خزنة فرع كامب شيزار ستبدأ برصيد 0</span>
            </label>
            <Button
              disabled={saving || !confirmZero}
              onClick={() => void save('ZERO')}
              className="bg-amber-600 hover:bg-amber-500"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : 'اعتماد رصيد صفر'}
            </Button>
          </section>

          <section className="rounded-xl border border-border/70 bg-card/70 p-4 space-y-3">
            <h3 className="font-semibold">ب. تسجيل رصيد افتتاحي</h3>
            <div>
              <Label>المبلغ</Label>
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>تاريخ السريان</Label>
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>السبب</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1" />
            </div>
            <Button
              disabled={saving || !(Number(amount) > 0) || reason.trim().length < 3}
              onClick={() => void save('AMOUNT')}
              className="bg-amber-600 hover:bg-amber-500"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : 'اعتماد الرصيد الافتتاحي'}
            </Button>
            <p className="text-xs text-muted-foreground">
              يُحفظ القرار في سياسة الإعداد. لا يُنشأ إيراد مبيعات وهمي.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
