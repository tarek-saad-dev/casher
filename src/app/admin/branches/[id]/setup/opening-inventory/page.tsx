'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';

type Option = 'ZERO_STOCK' | 'NEW_PURCHASE' | 'TRANSFER_FROM_GLEEM';

export default function OpeningInventorySetupPage() {
  const params = useParams<{ id: string }>();
  const branchId = params.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [option, setOption] = useState<Option>('ZERO_STOCK');
  const [approveZero, setApproveZero] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}/setup/opening-inventory`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التحميل');
      setResolved(!!data.resolved);
      setCurrent(data.current);
      if (data.current) setOption(data.current);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}/setup/opening-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          option,
          approveZeroStock: option === 'ZERO_STOCK' ? approveZero : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
      setMessage(
        data.blockerCleared
          ? 'تم اعتماد المخزون الافتتاحي وتصفية المانع'
          : 'تم تسجيل الخيار — يلزم إكمال الحركات (شراء/نقل) لتصفية المانع',
      );
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
        title="المخزون الافتتاحي"
        description="اختر مسارًا واحدًا واعتمده — لا تُنسخ كميات جليم مباشرة"
      />

      {loading ? (
        <Loader2 className="mt-6 size-5 animate-spin" />
      ) : (
        <div className="mt-6 space-y-4">
          {resolved && (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-3 text-sm text-emerald-200">
              معتمد: {current}
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

          {(
            [
              ['ZERO_STOCK', 'أ. بدء بدون مخزون افتتاحي'],
              ['NEW_PURCHASE', 'ب. مخزون مشترى جديد (يتطلب حركات لاحقًا)'],
              ['TRANSFER_FROM_GLEEM', 'ج. نقل من جليم (نقل مزدوج موثّق)'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-card/70 p-4"
            >
              <input
                type="radio"
                name="inv"
                checked={option === value}
                onChange={() => setOption(value)}
                className="mt-1"
              />
              <span className="text-sm font-medium">{label}</span>
            </label>
          ))}

          {option === 'ZERO_STOCK' && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={approveZero}
                onChange={(e) => setApproveZero(e.target.checked)}
                className="mt-1"
              />
              <span>أؤكد بدء الفرع بدون مخزون افتتاحي</span>
            </label>
          )}

          {(option === 'NEW_PURCHASE' || option === 'TRANSFER_FROM_GLEEM') && (
            <p className="text-xs text-amber-200/90">
              تسجيل الخيار لا يصفّي المانع وحده — يلزم إكمال شبكة الشراء أو نقل 1J ثم إعادة التقييم.
            </p>
          )}

          <Button
            disabled={saving || (option === 'ZERO_STOCK' && !approveZero)}
            onClick={() => void save()}
            className="bg-amber-600 hover:bg-amber-500"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : 'حفظ القرار'}
          </Button>
        </div>
      )}
    </div>
  );
}
