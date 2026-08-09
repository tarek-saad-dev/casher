'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Loader2, MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type TransferDestination = {
  branchId: number;
  branchCode: string;
  branchName: string;
};

type TransferableBarber = {
  empId: number;
  empName: string;
  section?: 'present' | 'transferred_in' | 'elsewhere' | 'off';
  isTransferred?: boolean;
  isGlobalDayOff?: boolean;
  transferReason?: string | null;
  attendance?: { status: string; checkInTime: string | null; checkOutTime: string | null } | null;
};

type TransferPreview = {
  canTransfer: boolean;
  canForceTransfer?: boolean;
  blockers?: Array<{ code: string; message: string }>;
  forceableBlockers?: Array<{ code: string; message: string }>;
  warnings?: string[];
  sourceBranch?: { branchId?: number; branchName: string } | null;
  destinationBranch?: { branchName: string } | null;
  resolvedDestinationWindow?: {
    startTime: string | null;
    endTime: string | null;
    overnight: boolean;
  } | null;
  affectedBookings?: Array<{
    bookingId: number;
    bookingCode: string | null;
    startTime: string;
  }>;
  activeTransfer?: { transferId: number; toBranchId: number; reason: string | null } | null;
};

/** Optional context from workforce layers / day board — makes the modal self-explanatory. */
export type TransferAssignmentContext = {
  employeeName?: string | null;
  /** e.g. الجدول الأساسي للفرع */
  assignedLayerTitleAr: string;
  /** Branch where they are placed today by that layer */
  assignedBranchName: string;
  /** Auto-filled "from" branch for the transfer */
  fromBranchName: string;
  fromBranchId?: number | null;
  assignedHoursLabel?: string | null;
  baseScheduleSourceAr?: string | null;
};

interface Props {
  open: boolean;
  onClose: () => void;
  workDate: string;
  /** Prefill employee when opened from a barber lane / schedule row. */
  initialEmpId?: number | null;
  /** Rich assignment summary when opened from workforce availability. */
  assignmentContext?: TransferAssignmentContext | null;
  onTransferred?: () => void;
}

function sectionLabel(section?: TransferableBarber['section']): string {
  switch (section) {
    case 'present':
      return 'حاضر هنا';
    case 'transferred_in':
      return 'منقول لهذا الفرع';
    case 'elsewhere':
      return 'في فرع آخر';
    case 'off':
      return 'حضور/غير مجدول';
    default:
      return '';
  }
}

export function TemporaryBranchTransferModal({
  open,
  onClose,
  workDate,
  initialEmpId = null,
  assignmentContext = null,
  onTransferred,
}: Props) {
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [barbers, setBarbers] = useState<TransferableBarber[]>([]);
  const [destinations, setDestinations] = useState<TransferDestination[]>([]);
  const [sessionBranchId, setSessionBranchId] = useState<number | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [empId, setEmpId] = useState<number | ''>('');
  const [toBranchId, setToBranchId] = useState<number | ''>('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [forceDespiteBlockers, setForceDespiteBlockers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBarber = useMemo(
    () => barbers.find((b) => b.empId === empId) ?? null,
    [barbers, empId],
  );

  const transferableBarbers = useMemo(
    () =>
      barbers.filter((b) => {
        if (b.isGlobalDayOff) return false;
        if (
          b.section === 'present' ||
          b.section === 'transferred_in' ||
          b.section === 'elsewhere'
        ) {
          return true;
        }
        if (b.section === 'off' && b.attendance) return true;
        return false;
      }),
    [barbers],
  );

  /** Never offer the branch the employee is already assigned to today. */
  const excludeFromBranchId =
    assignmentContext?.fromBranchId ??
    preview?.sourceBranch?.branchId ??
    sessionBranchId ??
    null;

  const destinationOptions = useMemo(
    () =>
      destinations.filter(
        (d) => excludeFromBranchId == null || d.branchId !== excludeFromBranchId,
      ),
    [destinations, excludeFromBranchId],
  );

  useEffect(() => {
    if (toBranchId === '') return;
    if (destinationOptions.some((d) => d.branchId === toBranchId)) return;
    setToBranchId(destinationOptions[0]?.branchId ?? '');
  }, [destinationOptions, toBranchId]);

  const fromBranchLabel =
    preview?.sourceBranch?.branchName ||
    assignmentContext?.fromBranchName ||
    '—';

  const employeeDisplayName =
    assignmentContext?.employeeName ||
    selectedBarber?.empName ||
    (empId ? `موظف #${empId}` : '—');

  const resetForm = useCallback((preferEmpId?: number | null) => {
    setEmpId(preferEmpId && preferEmpId > 0 ? preferEmpId : '');
    setToBranchId('');
    setStartTime('');
    setEndTime('');
    setReason('');
    setPreview(null);
    setForceDespiteBlockers(false);
    setError(null);
  }, []);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setMetaError(null);
    try {
      const res = await fetch(
        `/api/operations/schedule-control?date=${encodeURIComponent(workDate)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'تعذر تحميل قائمة الموظفين',
        );
      }
      const list = (data.barbers ?? []) as TransferableBarber[];
      setBarbers(list);
      const dests = (data.transferDestinations ?? []) as TransferDestination[];
      setDestinations(dests);
      setSessionBranchId(
        typeof data.sessionBranchId === 'number' ? data.sessionBranchId : null,
      );

      const prefer =
        preferEmpIdFrom(list, initialEmpId) ??
        list.find((b) => b.section === 'present' && !b.isGlobalDayOff)?.empId ??
        '';
      setEmpId(prefer || '');

      // Exclude the employee's current assignment branch (not merely session).
      const fromId =
        assignmentContext?.fromBranchId ??
        (typeof data.sessionBranchId === 'number' ? data.sessionBranchId : null);
      const available = dests.filter((d) => fromId == null || d.branchId !== fromId);
      setToBranchId(available[0]?.branchId ?? '');
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : 'تعذر تحميل البيانات');
      setBarbers([]);
      setDestinations([]);
      setSessionBranchId(null);
    } finally {
      setLoadingMeta(false);
    }
  }, [workDate, initialEmpId, assignmentContext?.fromBranchId]);

  useEffect(() => {
    if (!open) return;
    resetForm(initialEmpId);
    void loadMeta();
  }, [open, workDate, initialEmpId, loadMeta, resetForm]);

  useEffect(() => {
    setPreview(null);
    setForceDespiteBlockers(false);
    setError(null);
  }, [empId, toBranchId, startTime, endTime]);

  const runPreview = async () => {
    if (!empId || !toBranchId) {
      setError('اختر الموظف وفرع الوجهة');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/operations/employees/${empId}/temporary-transfer/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDate,
          toBranchId,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? 'فشل معاينة النقل');
      }
      setPreview(data.preview as TransferPreview);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'فشل معاينة النقل');
    } finally {
      setBusy(false);
    }
  };

  const applyTransfer = async () => {
    if (!empId || !toBranchId) {
      setError('اختر الموظف وفرع الوجهة');
      return;
    }
    if (!reason.trim()) {
      setError('سبب النقل مطلوب');
      return;
    }
    const canApply =
      preview?.canTransfer ||
      (forceDespiteBlockers && preview?.canForceTransfer);
    if (!canApply) {
      setError(
        preview?.canForceTransfer
          ? 'فعّل «تطبيق رغم الموانع» ثم أعد المحاولة'
          : 'نفّذ المعاينة أولاً وتأكد أن النقل مسموح',
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/operations/employees/${empId}/temporary-transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDate,
          toBranchId,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          reason: reason.trim(),
          forceDespiteBlockers:
            forceDespiteBlockers && preview?.canForceTransfer === true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? 'فشل النقل');
      }
      onTransferred?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل النقل');
    } finally {
      setBusy(false);
    }
  };

  const cancelActiveTransfer = async () => {
    if (!empId || !selectedBarber?.isTransferred) return;
    const cancelReason = window.prompt('سبب إلغاء النقل الطارئ');
    if (!cancelReason?.trim()) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/operations/employees/${empId}/temporary-transfer`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDate, reason: cancelReason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? 'فشل إلغاء النقل');
      }
      onTransferred?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل إلغاء النقل');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      dir="rtl"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-xl bg-amber-500/15 p-2.5">
              <ArrowLeftRight className="h-5 w-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-foreground">نقل موظف اليوم</h2>
              <p className="text-xs text-muted-foreground">
                نقل طارئ لتاريخ {workDate} فقط — لا يعدّل الجدول الأسبوعي
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="إغلاق"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5 max-h-[70vh] overflow-y-auto">
          {loadingMeta ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري التحميل…
            </div>
          ) : metaError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {metaError}
            </div>
          ) : (
            <>
              {/* Assignment context */}
              {assignmentContext ? (
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-sky-300 mt-0.5 shrink-0" />
                    <div className="min-w-0 space-y-1 text-sm">
                      <p className="font-medium text-sky-50">
                        هذا الموظف معيَّن اليوم من الطبقة:{' '}
                        <span className="text-white">
                          {assignmentContext.assignedLayerTitleAr}
                        </span>
                      </p>
                      <p className="text-sky-100/90 text-[13px]">
                        في فرع:{' '}
                        <strong className="text-white">
                          {assignmentContext.assignedBranchName}
                        </strong>
                        {assignmentContext.assignedHoursLabel
                          ? ` · ${assignmentContext.assignedHoursLabel}`
                          : ''}
                      </p>
                      {assignmentContext.baseScheduleSourceAr && (
                        <p className="text-[11px] text-sky-200/70">
                          مصدر الجدول: {assignmentContext.baseScheduleSourceAr}
                        </p>
                      )}
                      <p className="text-[11px] text-sky-200/60">
                        الموظف:{' '}
                        <strong className="text-sky-50">{employeeDisplayName}</strong>
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-foreground/80">الموظف</span>
                <select
                  className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-foreground"
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value ? Number(e.target.value) : '')}
                  disabled={busy || !!assignmentContext?.employeeName}
                >
                  <option value="">اختر موظفًا</option>
                  {transferableBarbers.map((b) => (
                    <option key={b.empId} value={b.empId}>
                      {b.empName}
                      {sectionLabel(b.section) ? ` — ${sectionLabel(b.section)}` : ''}
                      {b.isTransferred ? ' · نقل طارئ نشط' : ''}
                    </option>
                  ))}
                </select>
              </label>

              {selectedBarber?.isTransferred && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <p className="font-medium">هذا الموظف عليه نقل طارئ نشط اليوم.</p>
                  {selectedBarber.transferReason ? (
                    <p className="mt-1 text-amber-200/80">السبب: {selectedBarber.transferReason}</p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 border-amber-500/40 text-amber-100"
                    disabled={busy}
                    onClick={() => void cancelActiveTransfer()}
                  >
                    إلغاء النقل الطارئ
                  </Button>
                </div>
              )}

              {/* From / To branches */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium text-foreground/80">نقل من الفرع</span>
                  <div
                    className="w-full rounded-lg border border-border bg-zinc-900/60 px-3 py-2.5 text-sm text-foreground"
                    aria-readonly
                  >
                    {fromBranchLabel}
                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                      معبّأ تلقائيًا من تعيين اليوم
                    </span>
                  </div>
                </label>

                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium text-foreground/80">إلى الفرع</span>
                  <select
                    className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-foreground"
                    value={toBranchId}
                    onChange={(e) => setToBranchId(e.target.value ? Number(e.target.value) : '')}
                    disabled={busy || destinationOptions.length === 0}
                  >
                    <option value="">اختر فرع الوجهة</option>
                    {destinationOptions.map((d) => (
                      <option key={d.branchId} value={d.branchId}>
                        {d.branchName}
                      </option>
                    ))}
                  </select>
                  {destinationOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      لا توجد فروع أخرى متاحة للنقل (تم استبعاد فرع التعيين الحالي)
                    </p>
                  )}
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium text-foreground/80">من ساعة (اختياري)</span>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium text-foreground/80">إلى ساعة (اختياري)</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-2">
                لو سبت الساعات فاضي، هيُستخدم شيفت الوجهة أو مواعيد التعيين الحالية.
              </p>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-foreground/80">سبب النقل *</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                  placeholder="مثلاً: تغطية فرع كامب شيزار"
                  className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-foreground"
                />
              </label>

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {preview && (
                <div className="space-y-1.5 rounded-xl border border-border bg-surface-muted/40 p-3 text-xs text-foreground/90">
                  <p className="font-medium text-foreground mb-1">نتيجة المعاينة</p>
                  <p>
                    نقل من: <strong>{preview.sourceBranch?.branchName ?? fromBranchLabel}</strong>
                  </p>
                  <p>
                    إلى: <strong>{preview.destinationBranch?.branchName ?? '—'}</strong>
                  </p>
                  <p>
                    نافذة العمل:{' '}
                    {preview.resolvedDestinationWindow?.startTime ?? '—'} →{' '}
                    {preview.resolvedDestinationWindow?.endTime ?? '—'}
                    {preview.resolvedDestinationWindow?.overnight ? ' (+1)' : ''}
                  </p>
                  {preview.warnings?.map((w) => (
                    <p key={w} className="text-amber-300">
                      {w}
                    </p>
                  ))}
                  {preview.blockers?.map((b) => {
                    const soft = preview.forceableBlockers?.some((f) => f.code === b.code);
                    return (
                      <p
                        key={b.code}
                        className={soft ? 'text-amber-300' : 'text-destructive'}
                      >
                        {soft ? '⚠ ' : ''}
                        {b.message}
                      </p>
                    );
                  })}
                  {(preview.affectedBookings?.length ?? 0) > 0 && (
                    <div className="pt-1">
                      <p className="font-medium text-amber-300">
                        حجوزات في فرع المصدر (لا تُنقل تلقائياً):
                      </p>
                      {preview.affectedBookings?.map((bk) => (
                        <p key={bk.bookingId}>
                          {bk.bookingCode || bk.bookingId} — {bk.startTime}
                        </p>
                      ))}
                    </div>
                  )}
                  {preview.canTransfer && (
                    <p className="pt-1 font-medium text-emerald-300">المعاينة ناجحة — يمكن تطبيق النقل</p>
                  )}
                  {preview.canForceTransfer && !preview.canTransfer && (
                    <label className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[12px] text-amber-100 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={forceDespiteBlockers}
                        onChange={(e) => setForceDespiteBlockers(e.target.checked)}
                        disabled={busy}
                      />
                      <span>
                        تطبيق النقل رغم الموانع أعلاه (تعيين/راتب/خدمات الوجهة أو حجوزات المصدر).
                        الحجوزات تبقى في فرع المصدر ولن تُنقل تلقائياً.
                      </span>
                    </label>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
            className="flex-1"
          >
            إلغاء
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || loadingMeta || !empId || !toBranchId}
            onClick={() => void runPreview()}
            className={cn('flex-1 border-primary/40 text-primary')}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'معاينة'}
          </Button>
          <Button
            type="button"
            disabled={
              busy ||
              loadingMeta ||
              !empId ||
              !toBranchId ||
              !reason.trim() ||
              !(
                preview?.canTransfer ||
                (forceDespiteBlockers && preview?.canForceTransfer)
              )
            }
            onClick={() => void applyTransfer()}
            className="flex-1 bg-primary text-primary-foreground"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'تطبيق النقل'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function preferEmpIdFrom(
  list: TransferableBarber[],
  initialEmpId: number | null | undefined,
): number | '' {
  if (!initialEmpId) return '';
  return list.some((b) => b.empId === initialEmpId) ? initialEmpId : '';
}
