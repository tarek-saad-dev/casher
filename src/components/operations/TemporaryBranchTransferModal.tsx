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

type TransferableEmployee = {
  empId: number;
  empName: string;
  job: string | null;
  section?: 'present' | 'transferred_in' | 'elsewhere' | 'off';
  isTransferred?: boolean;
  isGlobalDayOff?: boolean;
  transferReason?: string | null;
  attendance?: { status: string; checkInTime: string | null; checkOutTime: string | null } | null;
  currentBranch?: { branchId: number; branchName: string } | null;
};

/** send = من الفرع الحالي لفرع آخر · pull = من فرع آخر للفرع الحالي */
type TransferDirection = 'send' | 'pull';

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
  attendance?: {
    hasOpen?: boolean;
    hasCompleted?: boolean;
    branchId?: number | null;
  } | null;
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

function sectionLabel(section?: TransferableEmployee['section']): string {
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

function isBarberJob(job: string | null | undefined): boolean {
  if (!job) return false;
  const j = job.trim().toLowerCase();
  return j === 'حلاق' || j === 'مساعد' || j === 'barber';
}

type JobFilter = 'all' | 'barbers' | 'other';

export function TemporaryBranchTransferModal({
  open,
  onClose,
  workDate,
  initialEmpId = null,
  assignmentContext = null,
  onTransferred,
}: Props) {
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [employees, setEmployees] = useState<TransferableEmployee[]>([]);
  const [destinations, setDestinations] = useState<TransferDestination[]>([]);
  const [sessionBranchId, setSessionBranchId] = useState<number | null>(null);
  const [sessionBranchName, setSessionBranchName] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [jobFilter, setJobFilter] = useState<JobFilter>('all');
  const [direction, setDirection] = useState<TransferDirection>('send');

  const [empId, setEmpId] = useState<number | ''>('');
  const [toBranchId, setToBranchId] = useState<number | ''>('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [forceDespiteBlockers, setForceDespiteBlockers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedEmployee = useMemo(
    () => employees.find((b) => b.empId === empId) ?? null,
    [employees, empId],
  );

  const directionLocked = Boolean(assignmentContext?.employeeName);

  const transferableEmployees = useMemo(() => {
    return employees.filter((b) => {
      if (jobFilter === 'barbers' && !isBarberJob(b.job)) return false;
      if (jobFilter === 'other' && isBarberJob(b.job)) return false;
      if (b.isGlobalDayOff) return false;

      if (direction === 'pull') {
        // استدعاء: موظفون على فروع أخرى (مش الحاضرين هنا)
        if (b.section === 'elsewhere') return true;
        if (b.section === 'present' || b.section === 'transferred_in') return false;
        if (b.currentBranch?.branchId != null && sessionBranchId != null) {
          return b.currentBranch.branchId !== sessionBranchId;
        }
        // بدون بيانات يوم: نعرضهم عشان المعاينة تحسم المصدر
        return b.section == null || b.section === 'off';
      }

      // إرسال: الحاضرون / المنقولون لهذا الفرع أولوية؛ باقي القائمة لو مفيش section
      if (b.section === 'elsewhere') return false;
      if (b.section === 'present' || b.section === 'transferred_in') return true;
      if (b.currentBranch?.branchId != null && sessionBranchId != null) {
        return b.currentBranch.branchId === sessionBranchId;
      }
      return b.section == null || b.section === 'off';
    });
  }, [employees, jobFilter, direction, sessionBranchId]);

  /** Never offer the branch the employee is already assigned to today. */
  const excludeFromBranchId =
    assignmentContext?.fromBranchId ??
    selectedEmployee?.currentBranch?.branchId ??
    preview?.sourceBranch?.branchId ??
    (direction === 'send' ? sessionBranchId : null) ??
    null;

  const destinationOptions = useMemo(() => {
    if (direction === 'pull' && sessionBranchId != null) {
      return destinations.filter((d) => d.branchId === sessionBranchId);
    }
    return destinations.filter(
      (d) => excludeFromBranchId == null || d.branchId !== excludeFromBranchId,
    );
  }, [destinations, excludeFromBranchId, direction, sessionBranchId]);

  useEffect(() => {
    if (direction === 'pull' && sessionBranchId != null) {
      if (toBranchId !== sessionBranchId) setToBranchId(sessionBranchId);
      return;
    }
    if (toBranchId === '') return;
    if (destinationOptions.some((d) => d.branchId === toBranchId)) return;
    setToBranchId(destinationOptions[0]?.branchId ?? '');
  }, [destinationOptions, toBranchId, direction, sessionBranchId]);

  const fromBranchLabel =
    preview?.sourceBranch?.branchName ||
    assignmentContext?.fromBranchName ||
    selectedEmployee?.currentBranch?.branchName ||
    (direction === 'send' ? sessionBranchName : null) ||
    '—';

  const toBranchLabel =
    preview?.destinationBranch?.branchName ||
    (direction === 'pull'
      ? sessionBranchName ||
        destinations.find((d) => d.branchId === sessionBranchId)?.branchName ||
        'الفرع الحالي'
      : null);

  const employeeDisplayName =
    assignmentContext?.employeeName ||
    selectedEmployee?.empName ||
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
    if (!assignmentContext?.employeeName) {
      setDirection('send');
    }
  }, [assignmentContext?.employeeName]);

  const applyDirection = useCallback(
    (next: TransferDirection) => {
      if (directionLocked || next === direction) return;
      setDirection(next);
      setEmpId('');
      setPreview(null);
      setForceDespiteBlockers(false);
      setError(null);
      if (next === 'pull' && sessionBranchId != null) {
        setToBranchId(sessionBranchId);
      } else {
        const fromId = sessionBranchId;
        const available = destinations.filter(
          (d) => fromId == null || d.branchId !== fromId,
        );
        setToBranchId(available[0]?.branchId ?? '');
      }
    },
    [directionLocked, direction, sessionBranchId, destinations],
  );

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setMetaError(null);
    try {
      // Meta = all active employees (HR + ops). Schedule-control is optional
      // enrichment for day sections — HR attendance may lack /operations access.
      const [empsRes, schedRes] = await Promise.all([
        fetch('/api/admin/hr/branch-transfer/meta'),
        fetch(`/api/operations/schedule-control?date=${encodeURIComponent(workDate)}`),
      ]);
      const empsData = await empsRes.json().catch(() => ({}));
      const schedData = await schedRes.json().catch(() => ({}));

      if (!empsRes.ok) {
        throw new Error(
          typeof empsData.error === 'string'
            ? empsData.error
            : 'تعذر تحميل قائمة الموظفين',
        );
      }

      const dayPeople = schedRes.ok
        ? ((schedData.barbers ?? []) as Array<{
            empId: number;
            empName: string;
            section?: TransferableEmployee['section'];
            isTransferred?: boolean;
            isGlobalDayOff?: boolean;
            transferReason?: string | null;
            attendance?: TransferableEmployee['attendance'];
            currentBranch?: {
              branchId: number;
              branchCode?: string;
              branchName: string;
            } | null;
          }>)
        : [];
      const dayById = new Map(dayPeople.map((b) => [b.empId, b]));

      const allEmps: TransferableEmployee[] = (
        (empsData.employees ?? []) as Array<{
          empId: number;
          empName: string;
          job: string | null;
        }>
      ).map((e) => {
        const day = dayById.get(e.empId);
        return {
          empId: e.empId,
          empName: e.empName,
          job: e.job,
          section: day?.section,
          isTransferred: day?.isTransferred,
          isGlobalDayOff: day?.isGlobalDayOff,
          transferReason: day?.transferReason,
          attendance: day?.attendance ?? null,
          currentBranch: day?.currentBranch
            ? {
                branchId: day.currentBranch.branchId,
                branchName: day.currentBranch.branchName,
              }
            : null,
        };
      });

      for (const d of dayPeople) {
        if (allEmps.some((e) => e.empId === d.empId)) continue;
        allEmps.push({
          empId: d.empId,
          empName: d.empName,
          job: null,
          section: d.section,
          isTransferred: d.isTransferred,
          isGlobalDayOff: d.isGlobalDayOff,
          transferReason: d.transferReason,
          attendance: d.attendance ?? null,
          currentBranch: d.currentBranch
            ? {
                branchId: d.currentBranch.branchId,
                branchName: d.currentBranch.branchName,
              }
            : null,
        });
      }

      allEmps.sort((a, b) => a.empName.localeCompare(b.empName, 'ar'));
      setEmployees(allEmps);

      const destsFromSched = schedRes.ok
        ? ((schedData.transferDestinations ?? []) as TransferDestination[])
        : [];
      const destsFromMeta = (
        (empsData.destinations ?? []) as Array<{
          branchId: number;
          branchCode: string;
          branchName: string;
        }>
      ).map((d) => ({
        branchId: d.branchId,
        branchCode: d.branchCode,
        branchName: d.branchName,
      }));
      const dests = destsFromSched.length > 0 ? destsFromSched : destsFromMeta;
      setDestinations(dests);

      const sessionId =
        schedRes.ok && typeof schedData.sessionBranchId === 'number'
          ? schedData.sessionBranchId
          : typeof empsData.activeBranchId === 'number'
            ? empsData.activeBranchId
            : null;
      setSessionBranchId(sessionId);
      const sessionName =
        (typeof schedData.sessionBranchName === 'string' && schedData.sessionBranchName) ||
        dests.find((d) => d.branchId === sessionId)?.branchName ||
        null;
      setSessionBranchName(sessionName);

      // اتجاه افتراضي: لو فتح من موظف على فرع تاني → استدعاء، وإلا إرسال
      let nextDirection: TransferDirection = 'send';
      if (assignmentContext?.fromBranchId != null && sessionId != null) {
        nextDirection =
          assignmentContext.fromBranchId === sessionId ? 'send' : 'pull';
      } else if (initialEmpId) {
        const seeded = allEmps.find((b) => b.empId === initialEmpId);
        if (seeded?.section === 'elsewhere') nextDirection = 'pull';
        else if (
          seeded?.currentBranch?.branchId != null &&
          sessionId != null &&
          seeded.currentBranch.branchId !== sessionId
        ) {
          nextDirection = 'pull';
        }
      }
      setDirection(nextDirection);

      const prefer =
        preferEmpIdFrom(allEmps, initialEmpId) ||
        (nextDirection === 'pull'
          ? allEmps.find((b) => b.section === 'elsewhere' && !b.isGlobalDayOff)?.empId
          : allEmps.find((b) => b.section === 'present' && !b.isGlobalDayOff)?.empId) ||
        '';
      setEmpId(prefer || '');

      if (nextDirection === 'pull' && sessionId != null) {
        setToBranchId(sessionId);
      } else {
        const fromId = assignmentContext?.fromBranchId ?? sessionId;
        const available = dests.filter((d) => fromId == null || d.branchId !== fromId);
        setToBranchId(available[0]?.branchId ?? '');
      }
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : 'تعذر تحميل البيانات');
      setEmployees([]);
      setDestinations([]);
      setSessionBranchId(null);
      setSessionBranchName(null);
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
    if (!empId || !selectedEmployee?.isTransferred) return;
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
              <p className="mt-1 text-[11px] leading-relaxed text-amber-200/90">
                قبل ساعة البداية يفضل يظهر في الفرع الأصلي فقط. من ساعة البداية يظهر في
                الوجهة — بعد ما تقفل حضور الفرع السابق (انصراف).
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

              {/* Direction: send out vs pull in */}
              {!directionLocked && (
                <div className="space-y-1.5">
                  <span className="block text-sm font-medium text-foreground/80">
                    اتجاه النقل
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => applyDirection('send')}
                      className={cn(
                        'rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
                        direction === 'send'
                          ? 'border-amber-500/50 bg-amber-500/15 text-amber-100'
                          : 'border-border bg-surface-muted text-muted-foreground hover:text-foreground',
                      )}
                    >
                      إرسال لفرع آخر
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => applyDirection('pull')}
                      className={cn(
                        'rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
                        direction === 'pull'
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                          : 'border-border bg-surface-muted text-muted-foreground hover:text-foreground',
                      )}
                    >
                      استدعاء لهذا الفرع
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {direction === 'pull'
                      ? 'هتجيب موظف من فرع تاني للفرع اللي واقف فيه دلوقتي.'
                      : 'هتبعت موظف من الفرع الحالي لفرع تاني.'}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="block text-sm font-medium text-foreground/80">الموظف</span>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'all', label: 'الكل' },
                      { id: 'barbers', label: 'حلاقين' },
                      { id: 'other', label: 'باقي الوظائف' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      disabled={busy || !!assignmentContext?.employeeName}
                      onClick={() => setJobFilter(f.id)}
                      className={cn(
                        'rounded-lg border px-2.5 py-1 text-xs transition-colors',
                        jobFilter === f.id
                          ? 'border-primary/50 bg-primary/15 text-primary'
                          : 'border-border bg-surface-muted text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <select
                  className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-foreground"
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value ? Number(e.target.value) : '')}
                  disabled={busy || !!assignmentContext?.employeeName}
                >
                  <option value="">
                    {direction === 'pull'
                      ? 'اختر موظفًا من فرع آخر'
                      : 'اختر موظفًا من هذا الفرع'}
                  </option>
                  {transferableEmployees.map((b) => (
                    <option key={b.empId} value={b.empId}>
                      {b.empName}
                      {b.job ? ` · ${b.job}` : ''}
                      {sectionLabel(b.section) ? ` — ${sectionLabel(b.section)}` : ''}
                      {b.section === 'elsewhere' && b.currentBranch?.branchName
                        ? ` (${b.currentBranch.branchName})`
                        : ''}
                      {b.isTransferred ? ' · نقل طارئ نشط' : ''}
                    </option>
                  ))}
                </select>
                {transferableEmployees.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {direction === 'pull'
                      ? 'مفيش موظفين ظاهرين على فروع تانية اليوم (أو مفيش صلاحية عرض الفروع الأخرى).'
                      : 'مفيش موظفين ظاهرين على هذا الفرع اليوم للنقل.'}
                  </p>
                )}
              </div>

              {selectedEmployee?.isTransferred && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <p className="font-medium">هذا الموظف عليه نقل طارئ نشط اليوم.</p>
                  {selectedEmployee.transferReason ? (
                    <p className="mt-1 text-amber-200/80">السبب: {selectedEmployee.transferReason}</p>
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
                      {direction === 'pull'
                        ? 'فرع الموظف الحالي (من تعيين اليوم)'
                        : 'معبّأ تلقائيًا من تعيين اليوم'}
                    </span>
                  </div>
                </label>

                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium text-foreground/80">إلى الفرع</span>
                  {direction === 'pull' ? (
                    <div
                      className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-foreground"
                      aria-readonly
                    >
                      {toBranchLabel || 'الفرع الحالي'}
                      <span className="block text-[10px] text-emerald-200/70 mt-0.5">
                        الفرع اللي واقف فيه دلوقتي
                      </span>
                    </div>
                  ) : (
                    <>
                      <select
                        className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-foreground"
                        value={toBranchId}
                        onChange={(e) =>
                          setToBranchId(e.target.value ? Number(e.target.value) : '')
                        }
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
                    </>
                  )}
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium text-foreground/80">يبدأ الظهور من ساعة</span>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium text-foreground/80">ينتهي في ساعة</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground"
                  />
                </label>
              </div>
              <div className="rounded-xl border border-border/80 bg-surface-muted/50 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground -mt-1 space-y-1">
                <p>
                  <strong className="text-foreground/85">مهم للسلاسة:</strong> حط ساعة البداية
                  = وقت ما هيبدأ يشتغل في الفرع الجديد. قبلها مش هيظهر هناك عند الكاشير.
                </p>
                <p>
                  لو الساعات فاضية = النقل يتحسب لليوم كله من لحظة الحفظ (يظهر فوراً في الوجهة).
                </p>
                <p>
                  الترتيب الصحيح: اشتغل في الفرع الأصلي → انصراف هناك → يبدأ الظهور/الحضور/الحجز
                  في الوجهة من ساعة البداية.
                </p>
              </div>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-foreground/80">سبب النقل *</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                  placeholder={
                    direction === 'pull'
                      ? 'مثلاً: محتاج تغطية هنا النهاردة'
                      : 'مثلاً: تغطية فرع كامب شيزار'
                  }
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
                  {preview.attendance?.hasOpen ? (
                    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-200">
                      عنده حضور مفتوح في الفرع السابق — لازم انصراف هناك قبل فتح الحضور في
                      الوجهة.
                    </p>
                  ) : null}
                  <p className="text-muted-foreground">
                    قبل ساعة البداية: يظهر في الفرع الأصلي فقط. بعدها: يظهر في الوجهة.
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
  list: TransferableEmployee[],
  initialEmpId: number | null | undefined,
): number | '' {
  if (!initialEmpId) return '';
  return list.some((b) => b.empId === initialEmpId) ? initialEmpId : '';
}
