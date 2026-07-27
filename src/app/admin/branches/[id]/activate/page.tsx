'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Readiness = {
  score: number;
  isReadyForInternalLive: boolean;
  blockers: Array<{ key: string; title: string; details: string; requiredFor: string[] }>;
  lifecycleStatus?: string;
};

export default function BranchActivatePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const branchId = params.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [lifecycle, setLifecycle] = useState('SETUP');
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }),
  );
  const [confirmText, setConfirmText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, rRes] = await Promise.all([
        fetch(`/api/admin/branches/${branchId}`),
        fetch(`/api/admin/branches/${branchId}/readiness`),
      ]);
      const bData = await bRes.json();
      const rData = await rRes.json();
      if (!bRes.ok) throw new Error(bData.error || 'فشل تحميل الفرع');
      if (!rRes.ok) throw new Error(rData.error || 'فشل تحميل الجاهزية');
      const branch = bData.branch ?? bData;
      setLifecycle(branch.LifecycleStatus || branch.lifecycleStatus || 'SETUP');
      setReadiness(rData.readiness ?? rData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const internalBlockers =
    readiness?.blockers?.filter((b) => b.requiredFor?.includes('internal_live')) ?? [];
  const ready = !!readiness?.isReadyForInternalLive;
  const alreadyLive = lifecycle === 'INTERNAL_LIVE' || lifecycle === 'PUBLIC_LIVE';

  const activate = async () => {
    if (!ready || !confirmText || reason.trim().length < 5) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // Recheck then transition — smokeRunId may be required by server for SMOKE→INTERNAL
      const res = await fetch(`/api/admin/branches/${branchId}/lifecycle-transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetStatus: 'INTERNAL_LIVE',
          reason: `${reason.trim()} | InternalLiveEffectiveDate=${effectiveDate}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'فشل التحويل');
      setMessage('تم فتح الفرع للتشغيل الداخلي — الحجز العام ما زال مغلقًا');
      await load();
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6" dir="rtl">
      <Link href={`/admin/branches/${branchId}/setup`} className="text-sm text-muted-foreground">
        ← معالج الإعداد
      </Link>
      <PageHeader
        title="المراجعة والتشغيل الداخلي"
        description="تفعيل INTERNAL_LIVE فقط — بدون PUBLIC_LIVE وبدون حجز عام"
      />

      {loading ? (
        <Loader2 className="mt-6 size-5 animate-spin" />
      ) : (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-border/70 bg-card/70 p-4 text-sm">
            <p>
              جاهز للتشغيل الداخلي:{' '}
              <strong className={ready ? 'text-emerald-300' : 'text-rose-300'}>
                {ready ? 'نعم' : 'لا'}
              </strong>
            </p>
            <p className="mt-1 text-muted-foreground">
              النتيجة {readiness?.score ?? 0}% · الحالة الحالية {lifecycle}
            </p>
          </div>

          {!ready && (
            <div className="rounded-xl border border-rose-500/35 bg-rose-950/25 p-4">
              <p className="font-semibold text-rose-200">الموانع المتبقية</p>
              <ul className="mt-2 space-y-1 text-sm text-rose-100/90">
                {internalBlockers.map((b) => (
                  <li key={b.key}>
                    <Link
                      className="underline"
                      href={`/admin/branches/${branchId}/setup`}
                    >
                      [{b.key}] {b.title}
                    </Link>
                    : {b.details}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {alreadyLive ? (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-4 text-emerald-200">
              الفرع يعمل داخليًا · الحجز العام غير مفعّل
              <div className="mt-3 flex gap-2">
                <Link
                  href={`/admin/branches/${branchId}/setup`}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
                >
                  إدارة إعدادات الفرع
                </Link>
                <Link
                  href={`/admin/branches/${branchId}/readiness`}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
                >
                  الاستعداد للحجز العام
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-border/70 bg-card/70 p-4">
              <div>
                <Label>تاريخ بدء التشغيل الداخلي</Label>
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
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmText}
                  onChange={(e) => setConfirmText(e.target.checked)}
                  className="mt-1"
                />
                <span>أؤكد فتح فرع كامب شيزار للتشغيل الداخلي بدون تفعيل الحجز العام</span>
              </label>
              {error && <p className="text-sm text-rose-300">{error}</p>}
              {message && <p className="text-sm text-emerald-300">{message}</p>}
              <Button
                disabled={!ready || !confirmText || reason.trim().length < 5 || saving}
                onClick={() => void activate()}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : 'فتح الفرع للتشغيل الداخلي'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
