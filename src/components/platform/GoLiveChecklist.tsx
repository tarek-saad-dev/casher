'use client';

import { useCallback, useEffect, useState } from 'react';
import { platformFetch } from '@/components/platform/platformFetch';
import type { TenantGoLiveReport } from '@/platform/onboarding/goLiveTypes';

function milestoneTone(status: string): string {
  if (status === 'done') return 'border-emerald-500/30 bg-emerald-500/5';
  if (status === 'not_applicable') return 'border-border bg-muted/20';
  return 'border-amber-500/30 bg-amber-500/5';
}

function milestoneIcon(status: string): string {
  if (status === 'done') return '✓';
  if (status === 'not_applicable') return '—';
  return '•';
}

export default function GoLiveChecklist({ tenantId }: { tenantId: string }) {
  const [report, setReport] = useState<TenantGoLiveReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await platformFetch<TenantGoLiveReport>(
        `/api/admin/platform/tenants/${tenantId}/go-live`,
      );
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل حالة التشغيل');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section id="go-live" className="scroll-mt-6 space-y-4 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">التشغيل الفعلي للعميل</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            من إنشاء الحساب إلى أول يوم تشغيل، أول وردية، أول فاتورة وأول حجز.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void reload()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {loading ? 'جاري الفحص…' : 'إعادة الفحص'}
          </button>
          <a
            href="/login"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          >
            فتح دخول العميل
          </a>
        </div>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}
      {!report && !error && <p className="text-sm text-muted-foreground">جاري تحميل قائمة التشغيل…</p>}

      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span className={report.status === 'READY_FOR_HANDOFF' ? 'text-emerald-600' : 'text-amber-600'}>
                  {report.status === 'READY_FOR_HANDOFF' ? 'جاهز للتسليم والتشغيل' : 'جاري استكمال التشغيل'}
                </span>
                <span className="font-mono text-muted-foreground">
                  {report.completed}/{report.total} · {report.progressPercent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${report.progressPercent}%` }}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {report.ownerLoginName ? (
                <>دخول المالك: <span dir="ltr" className="font-mono text-foreground">{report.ownerLoginName}</span></>
              ) : (
                'دخول المالك غير محدد'
              )}
            </div>
          </div>

          {report.primaryBranch && (
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
              الفرع الأساسي: <b>{report.primaryBranch.branchName ?? report.primaryBranch.branchCode}</b>
              {' · '}
              <span className="font-mono text-muted-foreground">{report.primaryBranch.branchCode}</span>
            </div>
          )}

          <div className="grid gap-2 md:grid-cols-2">
            {report.milestones.map((m) => (
              <article key={m.id} className={`rounded-lg border p-3 ${milestoneTone(m.status)}`}>
                <div className="flex items-start gap-2">
                  <span
                    className={
                      m.status === 'done'
                        ? 'text-emerald-600'
                        : m.status === 'not_applicable'
                          ? 'text-muted-foreground'
                          : 'text-amber-600'
                    }
                  >
                    {milestoneIcon(m.status)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-medium">{m.label}</h4>
                      {m.count != null && (
                        <span className="rounded-full bg-background/70 px-2 py-0.5 text-[11px] font-mono">
                          {m.count}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{m.detail}</p>
                    {m.status === 'pending' && (
                      <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                        التالي: {m.action}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs">
            <b>ترتيب التنفيذ المقترح:</b>{' '}
            سجّل دخول العميل → ابدأ يوم التشغيل → افتح وردية → نفّذ أول فاتورة → راجع الخزنة والتقرير
            {report.bookingInstalled ? ' → أنشئ أول حجز' : ''}. تفعيل الحجز العام وربط WhatsApp يظلان خطوتين منفصلتين بعد ثبات التشغيل الداخلي.
          </div>
        </>
      )}
    </section>
  );
}
