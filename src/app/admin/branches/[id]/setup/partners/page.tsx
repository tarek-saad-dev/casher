'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function PartnerSharesSetupPage() {
  const params = useParams<{ id: string }>();
  const branchId = params.id;
  const [effectiveFrom, setEffectiveFrom] = useState(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ partnerName: string; sharePercent: number; isActive: boolean }> | null>(null);

  const activate = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}/setup/partner-shares/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effectiveFrom }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التفعيل');
      setRows(data.rows ?? []);
      setMessage(
        `تم تفعيل نسب الشركاء من ${data.effectiveFrom} · المجموع ${data.totalPercent}%`,
      );
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
        title="نسب الشركاء"
        description="تفعيل المسودة المعتمدة 40/20/20/20 بتاريخ بدء التشغيل الداخلي"
      />

      <div className="mt-6 space-y-4 rounded-xl border border-border/70 bg-card/70 p-4">
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>أ/ عايدة — 40%</li>
          <li>أ/ طارق — 20%</li>
          <li>أ/ زياد — 20%</li>
          <li>أ/ عمر — 20%</li>
        </ul>
        <div>
          <Label>تاريخ بدء التشغيل الداخلي</Label>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="mt-1"
          />
        </div>
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {message && <p className="text-sm text-emerald-300">{message}</p>}
        {rows && (
          <ul className="text-sm">
            {rows.map((r) => (
              <li key={r.partnerName}>
                {r.partnerName}: {r.sharePercent}% {r.isActive ? '(فعّال)' : ''}
              </li>
            ))}
          </ul>
        )}
        <Button
          disabled={saving}
          onClick={() => void activate()}
          className="bg-amber-600 hover:bg-amber-500"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : 'تفعيل النسب بهذا التاريخ'}
        </Button>
        <p className="text-xs text-muted-foreground">
          لا يُعدَّل صفوف جليم. أ/ عايدة قد تبقى بدون مستخدم دخول مع نسبة مالية صحيحة.
        </p>
      </div>
    </div>
  );
}
