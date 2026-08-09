'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarDays,
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getCairoCalendarDate } from '@/lib/businessDate';

type EmployeeOpt = { empId: number; empName: string; job: string | null };
type DestinationOpt = {
  branchId: number;
  branchCode: string;
  branchName: string;
  lifecycleStatus: string;
};

type TransferPreview = {
  canTransfer: boolean;
  canForceTransfer?: boolean;
  canForceWithRelocate?: boolean;
  requiresRelocate?: boolean;
  blockers?: Array<{ code: string; message: string }>;
  forceableBlockers?: Array<{ code: string; message: string }>;
  relocatableBlockers?: Array<{ code: string; message: string }>;
  warnings?: string[];
  sourceBranch?: {
    branchId?: number;
    branchName: string;
    branchCode?: string;
    startTime?: string | null;
    endTime?: string | null;
  } | null;
  destinationBranch?: { branchName: string; branchCode?: string } | null;
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
  activeTransfer?: {
    transferId: number;
    toBranchId: number;
    reason: string | null;
  } | null;
  attendance?: {
    hasOpen: boolean;
    hasCompleted: boolean;
    branchId: number | null;
  };
  payrollState?: {
    hasPayroll: boolean;
    hasGeneratedPayroll?: boolean;
    hasPostedPayroll?: boolean;
    hasLedger: boolean;
  };
};

type HistoryRow = {
  transferId: number;
  empId: number;
  empName: string;
  fromBranchCode: string;
  fromBranchName: string;
  toBranchCode: string;
  toBranchName: string;
  workDate: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  isActive: boolean;
};

function monthStart(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

function shiftDate(ymd: string, days: number): string {
  const dt = new Date(`${ymd}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function BranchTransferPage() {
  const today = getCairoCalendarDate();
  const [workDate, setWorkDate] = useState(today);
  const [historyFrom, setHistoryFrom] = useState(monthStart(today));
  const [historyTo, setHistoryTo] = useState(today);

  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [destinations, setDestinations] = useState<DestinationOpt[]>([]);
  const [empFilter, setEmpFilter] = useState('');
  const [empId, setEmpId] = useState<number | ''>('');
  const [toBranchId, setToBranchId] = useState<number | ''>('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');

  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [forceDespiteBlockers, setForceDespiteBlockers] = useState(false);
  const [relocateAttendance, setRelocateAttendance] = useState(false);

  const [loadingMeta, setLoadingMeta] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const filteredEmployees = useMemo(() => {
    const q = empFilter.trim();
    if (!q) return employees;
    return employees.filter(
      (e) => e.empName.includes(q) || String(e.empId).includes(q),
    );
  }, [employees, empFilter]);

  const destinationOptions = useMemo(() => {
    const fromId = preview?.sourceBranch?.branchId ?? null;
    return destinations.filter((d) => fromId == null || d.branchId !== fromId);
  }, [destinations, preview?.sourceBranch?.branchId]);

  const isPastDate = workDate < today;

  const canApply = useMemo(() => {
    if (!preview || !empId || !toBranchId || !reason.trim()) return false;
    if (preview.canTransfer) return true;
    if (forceDespiteBlockers && preview.canForceTransfer) return true;
    if (
      forceDespiteBlockers &&
      relocateAttendance &&
      preview.canForceWithRelocate
    ) {
      return true;
    }
    return false;
  }, [
    preview,
    empId,
    toBranchId,
    reason,
    forceDespiteBlockers,
    relocateAttendance,
  ]);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/hr/branch-transfer/meta');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'تعذر تحميل البيانات',
        );
      }
      setEmployees((data.employees ?? []) as EmployeeOpt[]);
      const dests = (data.destinations ?? []) as DestinationOpt[];
      setDestinations(dests);
      setToBranchId((prev) => {
        if (prev !== '') return prev;
        return dests[0]?.branchId ?? '';
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل البيانات');
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const qs = new URLSearchParams({
        from: historyFrom,
        to: historyTo,
      });
      if (empId) qs.set('empId', String(empId));
      const res = await fetch(`/api/admin/hr/branch-transfer?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'تعذر تحميل السجل',
        );
      }
      setHistory((data.transfers ?? []) as HistoryRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل السجل');
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFrom, historyTo, empId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setPreview(null);
    setForceDespiteBlockers(false);
    setRelocateAttendance(false);
    setSuccess(null);
  }, [empId, workDate, toBranchId, startTime, endTime]);

  const runPreview = async () => {
    if (!empId || !toBranchId) {
      setError('اختر الموظف وفرع الوجهة');
      return;
    }
    setPreviewing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/admin/hr/branch-transfer/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId,
          workDate,
          toBranchId,
          startTime: startTime || null,
          endTime: endTime || null,
          relocateAttendance,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'فشل المعاينة',
        );
      }
      setPreview(data.preview as TransferPreview);
      if (data.preview?.requiresRelocate) {
        setRelocateAttendance(true);
        setForceDespiteBlockers(true);
      }
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'فشل المعاينة');
    } finally {
      setPreviewing(false);
    }
  };

  const applyTransfer = async () => {
    if (!canApply || !empId || !toBranchId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/admin/hr/branch-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId,
          workDate,
          toBranchId,
          reason: reason.trim(),
          startTime: startTime || null,
          endTime: endTime || null,
          forceDespiteBlockers,
          relocateAttendance,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.details?.preview) setPreview(data.details.preview);
        throw new Error(
          typeof data.error === 'string' ? data.error : 'فشل تطبيق النقل',
        );
      }
      setSuccess(
        typeof data.message === 'string'
          ? data.message
          : 'تم تطبيق النقل بنجاح',
      );
      setPreview(null);
      setReason('');
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تطبيق النقل');
    } finally {
      setSaving(false);
    }
  };

  const cancelTransfer = async (row: HistoryRow) => {
    if (!row.isActive) return;
    const ok = window.confirm(
      `إلغاء نقل ${row.empName} بتاريخ ${row.workDate}؟`,
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/hr/branch-transfer', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: row.empId,
          workDate: row.workDate,
          reason: 'إلغاء من صفحة نقل الفروع',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'فشل الإلغاء',
        );
      }
      setSuccess('تم إلغاء النقل');
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل الإلغاء');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 pb-10" dir="rtl">
      <PageHeader
        title="نقل موظف بين الفروع"
        description="نقل يومي (طارئ أو بتاريخ قديم) مع معاينة الموانع وسجل النقل — لا يغيّر الجدول الأسبوعي"
        actions={
          <Link
            href="/admin/hr"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1')}
          >
            <ArrowRight className="w-4 h-4" />
            الموظفون
          </Link>
        }
      />

      {loadingMeta ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin ml-2" />
          جاري التحميل...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Form */}
          <section className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ArrowLeftRight className="w-4 h-4 text-amber-400" />
              تنفيذ نقل ليوم محدد
            </div>

            {isPastDate && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                تاريخ قديم: لو فيه حضور/يومية غير مرحلة، فعّل «نقل الحضور مع النقل»
                بعد المعاينة. اليومية المرحلة للخزنة لازم تتلغي ترحيلها أولاً.
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>تاريخ العمل</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWorkDate(shiftDate(workDate, -1))}
                  >
                    السابق
                  </Button>
                  <Input
                    type="date"
                    value={workDate}
                    onChange={(e) => setWorkDate(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setWorkDate(shiftDate(workDate, 1))}
                  >
                    التالي
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setWorkDate(today)}
                  >
                    اليوم
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>بحث موظف</Label>
                <Input
                  value={empFilter}
                  onChange={(e) => setEmpFilter(e.target.value)}
                  placeholder="اسم أو رقم..."
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>الموظف</Label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={empId === '' ? '' : String(empId)}
                  onChange={(e) =>
                    setEmpId(e.target.value ? Number(e.target.value) : '')
                  }
                >
                  <option value="">— اختر —</option>
                  {filteredEmployees.map((e) => (
                    <option key={e.empId} value={e.empId}>
                      {e.empName}
                      {e.job ? ` · ${e.job}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>فرع الوجهة</Label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={toBranchId === '' ? '' : String(toBranchId)}
                  onChange={(e) =>
                    setToBranchId(e.target.value ? Number(e.target.value) : '')
                  }
                >
                  <option value="">— اختر —</option>
                  {destinationOptions.map((d) => (
                    <option key={d.branchId} value={d.branchId}>
                      {d.branchName} ({d.branchCode})
                    </option>
                  ))}
                </select>
                {preview?.sourceBranch && (
                  <p className="text-xs text-muted-foreground mt-1">
                    المصدر المستنتج: {preview.sourceBranch.branchName}
                    {preview.sourceBranch.startTime && preview.sourceBranch.endTime
                      ? ` · ${preview.sourceBranch.startTime}–${preview.sourceBranch.endTime}`
                      : ''}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>من (اختياري)</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>إلى (اختياري)</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>سبب النقل</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثال: تغطية فرع / تصحيح تاريخ قديم"
                />
              </div>
            </div>

            {(preview?.canForceTransfer || preview?.canForceWithRelocate) && (
              <div className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
                {(preview.canForceTransfer || preview.canForceWithRelocate) && (
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={forceDespiteBlockers}
                      onChange={(e) => setForceDespiteBlockers(e.target.checked)}
                    />
                    <span>تنفيذ رغم التحذيرات اللينة (تعيين/خطة راتب/خدمات/حجوزات مصدر)</span>
                  </label>
                )}
                {preview.requiresRelocate && (
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={relocateAttendance}
                      onChange={(e) => {
                        setRelocateAttendance(e.target.checked);
                        if (e.target.checked) setForceDespiteBlockers(true);
                      }}
                    />
                    <span>
                      نقل سجل الحضور واليومية غير المرحلة لفرع الوجهة (لتصحيح تاريخ قديم)
                    </span>
                  </label>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={previewing || !empId || !toBranchId}
                onClick={() => void runPreview()}
              >
                {previewing ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-1" />
                ) : null}
                معاينة
              </Button>
              <Button
                type="button"
                disabled={!canApply || saving}
                onClick={() => void applyTransfer()}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-1" />
                ) : null}
                تطبيق النقل
              </Button>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            {success && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                {success}
              </div>
            )}
          </section>

          {/* Preview panel */}
          <section className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="w-4 h-4 text-sky-400" />
              نتيجة المعاينة
            </div>
            {!preview ? (
              <p className="text-sm text-muted-foreground">
                اضغط «معاينة» لعرض فرع المصدر والموانع قبل التطبيق.
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="grid gap-2">
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <div className="text-xs text-muted-foreground">من</div>
                    <div>
                      {preview.sourceBranch?.branchName ?? '— غير محدد —'}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    <div className="text-xs text-muted-foreground">إلى</div>
                    <div>
                      {preview.destinationBranch?.branchName ?? '—'}
                      {preview.resolvedDestinationWindow?.startTime &&
                      preview.resolvedDestinationWindow?.endTime
                        ? ` · ${preview.resolvedDestinationWindow.startTime}–${preview.resolvedDestinationWindow.endTime}`
                        : ''}
                    </div>
                  </div>
                </div>

                {preview.canTransfer ? (
                  <div className="text-emerald-300">جاهز للتطبيق بدون موانع.</div>
                ) : null}

                {(preview.blockers?.length ?? 0) > 0 && (
                  <ul className="space-y-1">
                    {preview.blockers!.map((b) => (
                      <li
                        key={b.code}
                        className="rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-red-100"
                      >
                        <span className="font-mono text-[10px] opacity-70">{b.code}</span>
                        <div>{b.message}</div>
                      </li>
                    ))}
                  </ul>
                )}

                {(preview.warnings?.length ?? 0) > 0 && (
                  <ul className="space-y-1">
                    {preview.warnings!.map((w) => (
                      <li
                        key={w}
                        className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-amber-100"
                      >
                        {w}
                      </li>
                    ))}
                  </ul>
                )}

                {(preview.affectedBookings?.length ?? 0) > 0 && (
                  <div className="text-xs text-muted-foreground">
                    حجوزات مصدر: {preview.affectedBookings!.length} (لا تُنقل تلقائياً)
                  </div>
                )}

                {preview.activeTransfer && (
                  <div className="text-xs text-sky-200">
                    يوجد نقل نشط #{preview.activeTransfer.transferId} — سيتم استبداله.
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* History */}
      <section className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="w-4 h-4" />
            سجل النقل
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadHistory()}
            disabled={historyLoading}
          >
            {historyLoading ? (
              <Loader2 className="w-4 h-4 animate-spin ml-1" />
            ) : (
              <RefreshCw className="w-4 h-4 ml-1" />
            )}
            تحديث
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">من</Label>
            <Input
              type="date"
              value={historyFrom}
              onChange={(e) => setHistoryFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">إلى</Label>
            <Input
              type="date"
              value={historyTo}
              onChange={(e) => setHistoryTo(e.target.value)}
              className="w-40"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground text-right">
                <th className="py-2 px-2 font-medium">التاريخ</th>
                <th className="py-2 px-2 font-medium">الموظف</th>
                <th className="py-2 px-2 font-medium">من → إلى</th>
                <th className="py-2 px-2 font-medium">الساعات</th>
                <th className="py-2 px-2 font-medium">الحالة</th>
                <th className="py-2 px-2 font-medium">السبب</th>
                <th className="py-2 px-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    لا يوجد سجل في الفترة المحددة
                  </td>
                </tr>
              ) : (
                history.map((row) => (
                  <tr
                    key={row.transferId}
                    className="border-b border-border/30 hover:bg-muted/10"
                  >
                    <td className="py-2 px-2 whitespace-nowrap">{row.workDate}</td>
                    <td className="py-2 px-2">{row.empName}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      {row.fromBranchCode} → {row.toBranchCode}
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap text-muted-foreground">
                      {row.startTime && row.endTime
                        ? `${row.startTime}–${row.endTime}`
                        : '—'}
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded-full border',
                          row.isActive
                            ? 'border-emerald-500/40 text-emerald-300'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {row.isActive ? 'نشط' : 'ملغي'}
                      </span>
                    </td>
                    <td className="py-2 px-2 max-w-[220px] truncate" title={row.reason ?? ''}>
                      {row.reason ?? '—'}
                    </td>
                    <td className="py-2 px-2">
                      {row.isActive ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-red-300 hover:text-red-200"
                          disabled={saving}
                          onClick={() => void cancelTransfer(row)}
                        >
                          إلغاء
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
