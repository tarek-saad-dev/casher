'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import PageHeader from '@/components/shared/PageHeader';

type Readiness = {
  branchId: number;
  branchCode: string;
  lifecycleStatus: string;
  score: number;
  isReadyForSmoke: boolean;
  isReadyForInternalLive: boolean;
  isReadyForPublicLive: boolean;
  blockers: Array<{ key: string; title: string; details: string; section: string }>;
  warnings: Array<{ key: string; title: string; details: string; section: string }>;
  sections: Array<{
    section: string;
    items: Array<{ key: string; title: string; status: string; details: string }>;
  }>;
  evaluatedAt: string;
};

export default function BranchReadinessPage() {
  const params = useParams<{ id: string }>();
  const branchId = params.id;
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transitionMsg, setTransitionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}/readiness`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'فشل التحميل');
        return;
      }
      setReadiness(data.readiness);
    } catch {
      setError('فشل الاتصال');
    } finally {
      setBusy(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function recheck() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}/readiness/recheck`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'فشل إعادة الفحص');
        return;
      }
      setReadiness(data.readiness);
    } finally {
      setBusy(false);
    }
  }

  async function transition(targetStatus: string) {
    const reason = window.prompt('سبب التحويل (مطلوب):', '');
    if (!reason || reason.trim().length < 5) {
      setTransitionMsg('التحويل أُلغي — السبب مطلوب');
      return;
    }
    setBusy(true);
    setTransitionMsg(null);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}/lifecycle-transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStatus, reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setTransitionMsg(data.error || 'فشل التحويل');
        return;
      }
      setTransitionMsg(`تم: ${data.fromStatus} → ${data.toStatus}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6" dir="rtl">
      <PageHeader
        title="جاهزية الفرع"
        description="التفعيل يعتمد على الموانع (blockers) وليس النسبة فقط — لا يوجد تجاوز من الواجهة"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void recheck()}
          disabled={busy}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium"
        >
          Recheck
        </button>
        <Link
          href={`/admin/branches/${branchId}/setup`}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        >
          صفحة الإعداد
        </Link>
        <Link href="/admin/branches/new" className="rounded-lg border border-border px-3 py-2 text-sm">
          فرع جديد
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {transitionMsg && (
        <p className="mt-4 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">
          {transitionMsg}
        </p>
      )}

      {readiness && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary">
                {readiness.lifecycleStatus}
              </span>
              <span className="text-sm font-semibold">{readiness.branchCode}</span>
              <span className="text-sm text-muted-foreground">Score {readiness.score}%</span>
              <span className="text-xs text-muted-foreground">
                آخر تقييم: {new Date(readiness.evaluatedAt).toLocaleString('ar-EG')}
              </span>
            </div>
            <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <li>Ready for smoke: <strong>{readiness.isReadyForSmoke ? 'Yes' : 'No'}</strong></li>
              <li>
                Ready for internal live:{' '}
                <strong>{readiness.isReadyForInternalLive ? 'Yes' : 'No'}</strong>
              </li>
              <li>
                Ready for public live:{' '}
                <strong>{readiness.isReadyForPublicLive ? 'Yes' : 'No'}</strong>
              </li>
            </ul>
            <p className="mt-2 text-sm">
              <strong>{readiness.blockers.length}</strong> blockers ·{' '}
              <strong>{readiness.warnings.length}</strong> warnings
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !readiness.isReadyForSmoke}
              onClick={() => void transition('SMOKE_TEST')}
              className="rounded-lg bg-amber-600/90 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              → SMOKE_TEST
            </button>
            <button
              type="button"
              disabled={busy || !readiness.isReadyForInternalLive}
              onClick={() => void transition('INTERNAL_LIVE')}
              className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              → INTERNAL_LIVE
            </button>
            <button
              type="button"
              disabled={busy || !readiness.isReadyForPublicLive}
              onClick={() => void transition('PUBLIC_LIVE')}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              title="يتطلب جاهزية عامة + واجهة متعددة الفروع"
            >
              → PUBLIC_LIVE
            </button>
          </div>

          {readiness.blockers.length > 0 && (
            <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
              <h2 className="mb-2 font-semibold">الموانع</h2>
              <ul className="space-y-2 text-sm">
                {readiness.blockers.map((b) => (
                  <li key={b.key}>
                    <strong>{b.title}</strong> — {b.details}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {readiness.sections.map((sec) => (
            <section key={sec.section} className="rounded-2xl border border-border bg-surface p-4">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {sec.section}
              </h2>
              <ul className="space-y-1.5 text-sm">
                {sec.items.map((i) => (
                  <li key={i.key} className="flex gap-2">
                    <span
                      className={
                        i.status === 'pass'
                          ? 'text-emerald-600'
                          : i.status === 'blocker'
                            ? 'text-destructive'
                            : 'text-amber-600'
                      }
                    >
                      [{i.status}]
                    </span>
                    <span>
                      <strong>{i.title}</strong> — {i.details}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
