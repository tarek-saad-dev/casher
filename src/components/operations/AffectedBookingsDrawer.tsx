'use client';

/**
 * الحجوزات التي تحتاج إجراء — Operations affected-bookings drawer.
 * Alternatives and moves are server-side only (AvailabilityEngine + reschedule).
 */
import { useCallback, useEffect, useState } from 'react';
import { notifyBookingV2CancelSuccess } from '@/lib/operations/bookingV2/mutationSync';
import {
  X,
  Loader2,
  RefreshCw,
  Phone,
  MessageCircle,
  Check,
  AlertTriangle,
} from 'lucide-react';

type AffectedRow = {
  actionId: number;
  bookingId: number;
  bookingCode: string;
  empId: number;
  empName: string | null;
  branchId: number;
  branchName: string | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: string;
  reasonCode: string;
  sourceEvent: string;
  sourceLabelAr: string;
  resolutionStatus: string;
  followUpStatus: string;
  customerName: string | null;
  customerPhone: string | null;
  servicesSummary: string | null;
  whatsappStatus: string | null;
  whatsappLastError: string | null;
  whatsappUpdatedAt: string | null;
};

type Alternative = {
  rank: 1 | 2 | 3 | 4;
  kind: string;
  empId: number;
  empName: string | null;
  branchId: number;
  businessDate: string;
  time: string;
  startAtIso: string;
  labelAr: string;
};

type BulkItem = {
  bookingId: number;
  newStartAt: string;
  operationalDate: string;
  targetEmpId?: number;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  businessDate: string;
  onMoved?: () => void;
};

function waLabel(status: string | null): string {
  if (!status) return 'غير مطلوب / لا يوجد';
  switch (status) {
    case 'queued':
      return 'في الانتظار';
    case 'sending':
      return 'جارٍ الإرسال';
    case 'sent':
      return 'تم الإرسال';
    case 'failed':
      return 'فشل';
    default:
      return status;
  }
}

function followLabel(s: string): string {
  switch (s) {
    case 'pending_call':
      return 'بانتظار اتصال';
    case 'called':
      return 'تم الاتصال';
    case 'no_answer':
      return 'لا يوجد رد';
    case 'resolved':
      return 'تم المتابعة';
    default:
      return 'غير مطلوب';
  }
}

export function AffectedBookingsDrawer({
  isOpen,
  onClose,
  businessDate,
  onMoved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AffectedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [includePhone, setIncludePhone] = useState(false);
  const [future, setFuture] = useState(false);
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [whatsappFailed, setWhatsappFailed] = useState(false);
  const [pendingCall, setPendingCall] = useState(false);
  const [empIdFilter, setEmpIdFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [selected, setSelected] = useState<Record<number, BulkItem | null>>({});
  const [alts, setAlts] = useState<Record<number, Alternative[]>>({});
  const [altsLoading, setAltsLoading] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReport, setBulkReport] = useState<
    Array<{ bookingId: number; ok: boolean; error?: string }> | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (future) sp.set('future', '1');
      else sp.set('date', businessDate);
      if (unresolvedOnly) sp.set('unresolved', '1');
      else sp.set('unresolved', '0');
      if (whatsappFailed) sp.set('whatsappFailed', '1');
      if (pendingCall) sp.set('pendingCall', '1');
      if (empIdFilter.trim()) sp.set('empId', empIdFilter.trim());
      if (reasonFilter.trim()) sp.set('reason', reasonFilter.trim());
      const res = await fetch(`/api/operations/affected-bookings?${sp}`, {
        credentials: 'include',
      });
      const data = (await res.json()) as {
        ok?: boolean;
        bookings?: AffectedRow[];
        includePhone?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error || 'تعذر تحميل الحجوزات المتأثرة');
        setRows([]);
        return;
      }
      setRows(data.bookings ?? []);
      setIncludePhone(Boolean(data.includePhone));
    } catch {
      setError('تعذر الاتصال بالخادم');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    businessDate,
    future,
    unresolvedOnly,
    whatsappFailed,
    pendingCall,
    empIdFilter,
    reasonFilter,
  ]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const loadAlternatives = async (bookingId: number) => {
    setAltsLoading(bookingId);
    try {
      const res = await fetch('/api/operations/affected-bookings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'alternatives', bookingId }),
      });
      const data = (await res.json()) as { ok?: boolean; alternatives?: Alternative[] };
      setAlts((prev) => ({ ...prev, [bookingId]: data.alternatives ?? [] }));
    } finally {
      setAltsLoading(null);
    }
  };

  const moveOne = async (
    bookingId: number,
    alt: Alternative,
  ): Promise<boolean> => {
    if (alt.kind === 'other_branch') {
      setError('نقل لفرع آخر يتطلب إلغاء وإعادة حجز — غير مدعوم تلقائياً');
      return false;
    }
    setBusyId(bookingId);
    setError(null);
    try {
      const res = await fetch('/api/operations/affected-bookings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'move',
          bookingId,
          newStartAt: alt.startAtIso,
          operationalDate: alt.businessDate,
          targetEmpId: alt.empId,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || 'فشل نقل الحجز');
        return false;
      }
      onMoved?.();
      await load();
      return true;
    } finally {
      setBusyId(null);
    }
  };

  const leavePending = async (bookingId: number) => {
    setBusyId(bookingId);
    try {
      await fetch('/api/operations/affected-bookings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, status: 'left_pending' }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const cancelExplicit = async (row: AffectedRow) => {
    if (!window.confirm('إلغاء صريح لهذا الحجز؟ لن يتم الإلغاء بصمت — سيتم إشعار العميل إن أمكن.')) {
      return;
    }
    setBusyId(row.bookingId);
    try {
      const res = await fetch('/api/operations/affected-bookings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel-booking', bookingId: row.bookingId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || 'فشل الإلغاء');
        return;
      }
      await notifyBookingV2CancelSuccess({
        employeeId: row.empId,
        businessDate: row.bookingDate,
      });
      onMoved?.();
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const markCall = async (bookingId: number, followUpStatus: string) => {
    setBusyId(bookingId);
    try {
      await fetch('/api/operations/affected-bookings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, followUpStatus }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const retryWa = async (bookingId: number) => {
    setBusyId(bookingId);
    try {
      const res = await fetch('/api/operations/affected-bookings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry-whatsapp', bookingId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || 'فشلت إعادة محاولة واتساب');
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelect = (row: AffectedRow, alt: Alternative) => {
    if (alt.kind === 'other_branch') return;
    setSelected((prev) => {
      const cur = prev[row.bookingId];
      if (cur && cur.newStartAt === alt.startAtIso) {
        const next = { ...prev };
        delete next[row.bookingId];
        return next;
      }
      return {
        ...prev,
        [row.bookingId]: {
          bookingId: row.bookingId,
          newStartAt: alt.startAtIso,
          operationalDate: alt.businessDate,
          targetEmpId: alt.empId,
        },
      };
    });
  };

  const runBulkMove = async () => {
    const items = Object.values(selected).filter(Boolean) as BulkItem[];
    if (!items.length) return;
    if (!window.confirm(`مراجعة ونقل ${items.length} حجز(ات)؟`)) return;
    setBulkBusy(true);
    setBulkReport(null);
    try {
      const res = await fetch('/api/operations/affected-bookings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk-move', items }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        results?: Array<{ bookingId: number; ok: boolean; error?: string }>;
      };
      setBulkReport(data.results ?? []);
      setSelected({});
      onMoved?.();
      await load();
    } finally {
      setBulkBusy(false);
    }
  };

  if (!isOpen) return null;

  const selectedCount = Object.keys(selected).length;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/40" dir="rtl">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="إغلاق"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-s border-border bg-background shadow-xl">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">الحجوزات التي تحتاج إجراء</h2>
            <p className="text-xs text-muted-foreground">
              {future ? 'الحجوزات المستقبلية المتأثرة' : `يوم التشغيل ${businessDate}`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg p-2 text-muted-foreground hover:bg-surface-muted"
              title="تحديث"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-muted-foreground hover:bg-surface-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex shrink-0 flex-wrap gap-2 border-b border-border px-4 py-2 text-xs">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={future}
              onChange={(e) => setFuture(e.target.checked)}
            />
            مستقبلية
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={unresolvedOnly}
              onChange={(e) => setUnresolvedOnly(e.target.checked)}
            />
            غير محلولة فقط
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={whatsappFailed}
              onChange={(e) => setWhatsappFailed(e.target.checked)}
            />
            واتساب فاشل
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={pendingCall}
              onChange={(e) => setPendingCall(e.target.checked)}
            />
            بانتظار اتصال
          </label>
          <input
            className="w-24 rounded border border-border bg-background px-2 py-1"
            placeholder="موظف ID"
            value={empIdFilter}
            onChange={(e) => setEmpIdFilter(e.target.value)}
          />
          <input
            className="w-28 rounded border border-border bg-background px-2 py-1"
            placeholder="سبب"
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
          />
        </div>

        {selectedCount > 0 && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-accent/30 bg-accent/10 px-4 py-2 text-sm">
            <span>محدد للنقل: {selectedCount}</span>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void runBulkMove()}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {bulkBusy ? 'جارٍ النقل…' : 'مراجعة ونقل المحدد'}
            </button>
          </div>
        )}

        {bulkReport && (
          <div className="shrink-0 border-b border-border px-4 py-2 text-xs">
            <p className="mb-1 font-semibold">نتيجة النقل الجماعي:</p>
            <ul className="max-h-24 space-y-0.5 overflow-y-auto">
              {bulkReport.map((r) => (
                <li key={r.bookingId} className={r.ok ? 'text-emerald-700' : 'text-destructive'}>
                  #{r.bookingId}: {r.ok ? 'تم' : r.error || 'فشل'}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="mx-4 mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && !rows.length ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !rows.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              لا توجد حجوزات تحتاج إجراء حالياً
            </p>
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => (
                <li
                  key={row.actionId}
                  className="rounded-xl border border-border bg-surface-muted/40 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground">
                        {row.customerName || 'عميل'}{' '}
                        <span className="text-xs font-normal text-muted-foreground">
                          {row.bookingCode}
                        </span>
                      </p>
                      {includePhone && row.customerPhone && (
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {row.customerPhone}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.empName || row.empId} · {row.branchName} · {row.bookingDate}{' '}
                        {row.startTime}–{row.endTime}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.servicesSummary || '—'}
                      </p>
                      <p className="mt-1 text-xs">
                        <span className="font-medium text-amber-800 dark:text-amber-200">
                          {row.sourceLabelAr}
                        </span>{' '}
                        <span className="text-muted-foreground">({row.reasonCode})</span>
                      </p>
                      <p className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span>الحالة: {row.resolutionStatus}</span>
                        <span className="inline-flex items-center gap-0.5">
                          <MessageCircle className="h-3 w-3" />
                          واتساب: {waLabel(row.whatsappStatus)}
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          <Phone className="h-3 w-3" />
                          اتصال: {followLabel(row.followUpStatus)}
                        </span>
                      </p>
                      {row.whatsappStatus === 'failed' && row.whatsappLastError && (
                        <p className="mt-0.5 text-[11px] text-destructive">
                          {row.whatsappLastError}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-background"
                        onClick={() => void loadAlternatives(row.bookingId)}
                        disabled={altsLoading === row.bookingId}
                      >
                        {altsLoading === row.bookingId ? '…' : 'بدائل'}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-background"
                        disabled={busyId === row.bookingId}
                        onClick={() => void leavePending(row.bookingId)}
                      >
                        إبقاء معلق
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-background"
                        disabled={busyId === row.bookingId}
                        onClick={() => void markCall(row.bookingId, 'pending_call')}
                      >
                        متابعة هاتف
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-background"
                        disabled={busyId === row.bookingId}
                        onClick={() => void markCall(row.bookingId, 'called')}
                      >
                        تم الاتصال
                      </button>
                      {row.whatsappStatus === 'failed' && (
                        <button
                          type="button"
                          className="rounded-md border border-amber-500/40 px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-50 dark:text-amber-200"
                          disabled={busyId === row.bookingId}
                          onClick={() => void retryWa(row.bookingId)}
                        >
                          إعادة واتساب
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded-md border border-destructive/40 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                        disabled={busyId === row.bookingId}
                        onClick={() => void cancelExplicit(row)}
                      >
                        إلغاء صريح
                      </button>
                    </div>
                  </div>

                  {(alts[row.bookingId] ?? []).length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                      {alts[row.bookingId].map((alt) => (
                        <li
                          key={`${alt.rank}-${alt.startAtIso}-${alt.empId}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-2 py-1.5 text-xs"
                        >
                          <span>
                            <span className="font-semibold">#{alt.rank}</span> {alt.labelAr}
                          </span>
                          <span className="flex gap-1">
                            {alt.kind !== 'other_branch' && (
                              <button
                                type="button"
                                className="rounded border border-border px-2 py-0.5"
                                onClick={() => toggleSelect(row, alt)}
                              >
                                {selected[row.bookingId]?.newStartAt === alt.startAtIso ? (
                                  <Check className="inline h-3 w-3" />
                                ) : (
                                  'تحديد'
                                )}
                              </button>
                            )}
                            {alt.kind !== 'other_branch' && (
                              <button
                                type="button"
                                className="rounded bg-primary px-2 py-0.5 font-medium text-primary-foreground disabled:opacity-50"
                                disabled={busyId === row.bookingId}
                                onClick={() => void moveOne(row.bookingId, alt)}
                              >
                                نقل
                              </button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
