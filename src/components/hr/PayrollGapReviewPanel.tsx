'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, AlertTriangle, Banknote, CalendarRange, CheckCircle2, ClipboardList,
  Loader2, Play, RefreshCw, UserCheck, Wrench,
} from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { getCairoMonthCloseAwareMonth } from '@/lib/businessDate';
import type {
  PayrollGapApplyResponse,
  PayrollGapAssignAttendanceResponse,
  PayrollGapDayCategory,
  PayrollGapGenerateDayResponse,
  PayrollGapReviewResponse,
} from '@/lib/types/payroll-gap-review';
import { canAssignDayAttendance, canGenerateDayPayroll } from '@/lib/hr/employeePayrollGapReview.classify';
import { cn } from '@/lib/utils';

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const CATEGORY_TONE: Record<PayrollGapDayCategory, string> = {
  ok: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  future: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  schedule_off: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  schedule_off_with_payroll: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  missing_payroll: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  incomplete_attendance: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  attendance_no_payroll: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  no_attendance: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  non_payable_no_payroll: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  posted_payroll: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
};

interface EmployeeOption {
  EmpID: number;
  EmpName: string;
}

interface BranchOption {
  branchId: number;
  branchCode: string;
  branchName: string;
}

function parseMonth(monthStr: string): { year: number; month: number } {
  const [y, m] = monthStr.split('-').map(Number);
  return { year: y, month: m };
}

export default function PayrollGapReviewPanel() {
  const defaultMonth = getCairoMonthCloseAwareMonth();
  const { year: initYear, month: initMonth } = parseMonth(defaultMonth);

  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);
  const [empId, setEmpId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [review, setReview] = useState<PayrollGapReviewResponse | null>(null);
  const [applyResult, setApplyResult] = useState<PayrollGapApplyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [generatingDay, setGeneratingDay] = useState<string | null>(null);
  const [assigningDay, setAssigningDay] = useState<string | null>(null);
  const [rowFlash, setRowFlash] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [error, setError] = useState('');

  const [markScheduledOffAsDayOff, setMarkScheduledOffAsDayOff] = useState(true);
  const [removeScheduledOffPayroll, setRemoveScheduledOffPayroll] = useState(true);
  const [completeAttendance, setCompleteAttendance] = useState(true);
  const [generatePayroll, setGeneratePayroll] = useState(true);
  const [defaultCheckout, setDefaultCheckout] = useState('02:00');

  useEffect(() => {
    (async () => {
      try {
        const [empRes, activeRes, branchesRes] = await Promise.all([
          fetch('/api/employees'),
          fetch('/api/branches/active'),
          fetch('/api/branches/available'),
        ]);
        if (empRes.ok) {
          const data = await empRes.json();
          const list = (Array.isArray(data) ? data : data.employees ?? []) as EmployeeOption[];
          setEmployees(list.filter((e) => e.EmpID && e.EmpName));
        }
        const activeData = await activeRes.json().catch(() => ({}));
        const branchesData = await branchesRes.json().catch(() => ({}));
        const activeId =
          Number(
            activeData?.activeBranch?.BranchID ??
              activeData?.activeBranch?.branchId ??
              0,
          ) || null;
        const list = Array.isArray(branchesData?.branches)
          ? (branchesData.branches as Array<{
              BranchID: number;
              BranchCode: string;
              BranchName: string;
            }>).map((b) => ({
              branchId: Number(b.BranchID),
              branchCode: String(b.BranchCode ?? ''),
              branchName: String(b.BranchName ?? ''),
            }))
          : [];
        setBranches(list);
        if (activeId) setBranchId(String(activeId));
        else if (list[0]) setBranchId(String(list[0].branchId));
      } catch {
        /* ignore bootstrap errors */
      }
    })();
  }, []);

  const loadReview = useCallback(async () => {
    if (!empId || !branchId) {
      setError('اختر الموظف والفرع أولاً');
      return;
    }
    setLoading(true);
    setError('');
    setApplyResult(null);
    setRowFlash({});
    try {
      const qs = new URLSearchParams({
        empId,
        branchId,
        year: String(year),
        month: String(month),
      });
      const res = await fetch(`/api/admin/hr/payroll-gap-review?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل المراجعة');
      setReview(data as PayrollGapReviewResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير معروف');
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [empId, branchId, year, month]);

  const runApply = useCallback(async () => {
    if (!empId || !branchId) return;
    setApplying(true);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/payroll-gap-review/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: Number(empId),
          branchId: Number(branchId),
          year,
          month,
          options: {
            markScheduledOffAsDayOff,
            removeScheduledOffPayroll,
            completeIncompleteAttendance: completeAttendance,
            generateMissingPayroll: generatePayroll,
            skipFutureDays: true,
            reopenClosedDays: true,
            defaultCheckoutTime: defaultCheckout,
            notesPrefix: '[GapReview] ',
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التنفيذ');
      setApplyResult(data as PayrollGapApplyResponse);
      setReview(data.review);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير معروف');
    } finally {
      setApplying(false);
    }
  }, [
    empId, branchId, year, month,
    markScheduledOffAsDayOff, removeScheduledOffPayroll, completeAttendance, generatePayroll, defaultCheckout,
  ]);

  const generateDayPayroll = useCallback(
    async (workDate: string) => {
      if (!empId || !branchId || !review) return;
      setGeneratingDay(workDate);
      setError('');
      try {
        const res = await fetch('/api/admin/hr/payroll-gap-review/generate-day', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            empId: Number(empId),
            branchId: Number(branchId),
            year,
            month,
            workDate,
            options: {
              defaultCheckoutTime: defaultCheckout,
              notesPrefix: '[GapReview] ',
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل توليد اليومية');
        const result = data as PayrollGapGenerateDayResponse;
        setReview(result.review);
        setRowFlash((prev) => ({
          ...prev,
          [workDate]: { ok: result.success, message: result.message },
        }));
        if (!result.success) {
          setError(result.message);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'خطأ غير معروف';
        setError(msg);
        setRowFlash((prev) => ({ ...prev, [workDate]: { ok: false, message: msg } }));
      } finally {
        setGeneratingDay(null);
      }
    },
    [empId, branchId, year, month, review, defaultCheckout],
  );

  const assignDayAttendance = useCallback(
    async (workDate: string) => {
      if (!empId || !branchId || !review) return;
      setAssigningDay(workDate);
      setError('');
      try {
        const res = await fetch('/api/admin/hr/payroll-gap-review/assign-attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            empId: Number(empId),
            branchId: Number(branchId),
            year,
            month,
            workDate,
            options: {
              defaultCheckoutTime: defaultCheckout,
              notesPrefix: '[GapReview] ',
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل تعيين الحضور');
        const result = data as PayrollGapAssignAttendanceResponse;
        setReview(result.review);
        setRowFlash((prev) => ({
          ...prev,
          [workDate]: { ok: result.success, message: result.message },
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'خطأ غير معروف';
        setError(msg);
        setRowFlash((prev) => ({ ...prev, [workDate]: { ok: false, message: msg } }));
      } finally {
        setAssigningDay(null);
      }
    },
    [empId, branchId, year, month, review, defaultCheckout],
  );

  const actionableRows = useMemo(
    () => review?.days.filter((d) => d.actionable) ?? [],
    [review],
  );

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 1, y, y + 1];
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <ClipboardList className="w-6 h-6 text-primary shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-bold text-white">مراجعة فجوات اليوميات</h2>
            <p className="text-sm text-zinc-400 mt-1">
              تحليل شهري لموظف في فرع: أيام بدون يوميات، حضور ناقص، أيام إجازته من الجدول الأسبوعي، والأيام المستقبلية.
              التنفيذ التلقائي يطبّق نفس منطق التصحيح اليدوي (إجازة حسب الجدول، إكمال خروج، توليد يوميات).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">الموظف</label>
            <Select value={empId} onValueChange={setEmpId}>
              <SelectTrigger><SelectValue placeholder="اختر موظفاً" /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.EmpID} value={String(e.EmpID)}>{e.EmpName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">الفرع</label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue placeholder="اختر فرعاً" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.branchId} value={String(b.branchId)}>
                    {b.branchName || b.branchCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">السنة</label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">الشهر</label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AR_MONTHS.map((label, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={loadReview} disabled={loading || !empId || !branchId}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <RefreshCw className="w-4 h-4 ml-2" />}
            تحليل الشهر
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {review && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard title="يوميات متولّدة" value={String(review.summary.payrollDays)} icon={<Banknote className="w-5 h-5" />} />
            <KpiCard title="حضور مسجّل" value={String(review.summary.attendanceDays)} icon={<CalendarRange className="w-5 h-5" />} />
            <KpiCard
              title="ناقص يوميات"
              value={String(review.summary.missingPayroll)}
              icon={<AlertTriangle className="w-5 h-5" />}
              variant={review.summary.missingPayroll > 0 ? 'warning' : 'default'}
            />
            <KpiCard title="يحتاج إجراء" value={String(review.summary.actionableDays)} icon={<Wrench className="w-5 h-5" />} />
          </div>

          <p className="text-xs text-zinc-500">
            مراجعة حتى: <span className="text-zinc-300 font-mono">{review.reviewThroughDate}</span>
            {' · '}
            الأيام بعد هذا التاريخ تُعرض كـ «مستقبلية» ولا تُولَّد تلقائياً.
            {review.employeeOffDaysLabel && (
              <>
                {' · '}
                أيام إجازة الموظف: <span className="text-sky-300">{review.employeeOffDaysLabel}</span>
              </>
            )}
          </p>

          {actionableRows.length > 0 && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-4">
              <h3 className="text-sm font-semibold text-amber-200 flex items-center gap-2">
                <Wrench className="w-4 h-4" />
                إجراءات تلقائية ({actionableRows.length} يوم)
              </h3>
              <div className="grid sm:grid-cols-2 gap-2 text-sm text-zinc-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={markScheduledOffAsDayOff}
                    onChange={(e) => setMarkScheduledOffAsDayOff(e.target.checked)}
                  />
                  يوم إجازته ({review.employeeOffDaysLabel || 'من الجدول'}) → إجازة
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={removeScheduledOffPayroll}
                    onChange={(e) => setRemoveScheduledOffPayroll(e.target.checked)}
                  />
                  حذف يوميات أيام الإجازة (غير المرحّلة)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={completeAttendance} onChange={(e) => setCompleteAttendance(e.target.checked)} />
                  إكمال حضور ناقص (خروج افتراضي)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={generatePayroll} onChange={(e) => setGeneratePayroll(e.target.checked)} />
                  توليد اليوميات الناقصة
                </label>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">وقت خروج افتراضي (ليلي)</label>
                  <Input
                    value={defaultCheckout}
                    onChange={(e) => setDefaultCheckout(e.target.value)}
                    className="w-28 font-mono"
                    placeholder="02:00"
                  />
                </div>
                <Button onClick={runApply} disabled={applying} variant="default">
                  {applying ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Play className="w-4 h-4 ml-2" />}
                  تنفيذ التصحيحات
                </Button>
              </div>
            </div>
          )}

          {applyResult && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm text-emerald-200 space-y-1">
              <p className="font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                تم التنفيذ
              </p>
              <p>
                إجازة مجدولة: {applyResult.summary.scheduledOffMarked}
                {' · '}
                حذف يوميات إجازة: {applyResult.summary.scheduledOffPayrollRemoved}
              </p>
              <p>إكمال حضور: {applyResult.summary.attendanceCompleted} · توليد يوميات: {applyResult.summary.payrollGenerated}</p>
              {applyResult.summary.failures.length > 0 && (
                <p className="text-rose-300">أخطاء: {applyResult.summary.failures.join(' · ')}</p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-300">
                {review.empName} — {review.branchName} — {AR_MONTHS[review.month - 1]} {review.year}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                    <th className="px-3 py-3 text-right">التاريخ</th>
                    <th className="px-3 py-3 text-right">اليوم</th>
                    <th className="px-3 py-3 text-right">الحالة</th>
                    <th className="px-3 py-3 text-right">حضور</th>
                    <th className="px-3 py-3 text-right">دخول</th>
                    <th className="px-3 py-3 text-right">خروج</th>
                    <th className="px-3 py-3 text-right">يومية</th>
                    <th className="px-3 py-3 text-right">ساعات</th>
                    <th className="px-3 py-3 text-right">إجراء مقترح</th>
                    <th className="px-3 py-3 text-right">رابط</th>
                    <th className="px-3 py-3 text-right">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {review.days.map((row) => (
                    <tr
                      key={row.workDate}
                      className={cn(
                        'border-b border-zinc-800/50',
                        row.actionable && 'bg-amber-950/20',
                      )}
                    >
                      <td className="px-3 py-2.5 font-mono text-zinc-300">{row.workDate}</td>
                      <td className="px-3 py-2.5 text-zinc-400">
                        {row.dayNameAr}
                        {row.isScheduledOff && (
                          <span className="mr-1.5 inline-flex rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                            إجازة
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-flex rounded-md border px-2 py-0.5 text-xs', CATEGORY_TONE[row.category])}>
                          {row.categoryLabelAr}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-zinc-400">{row.attendanceStatus ?? '—'}</td>
                      <td className="px-3 py-2.5 font-mono">{row.checkIn ?? '—'}</td>
                      <td className="px-3 py-2.5 font-mono">{row.checkOut ?? '—'}</td>
                      <td className="px-3 py-2.5 font-mono text-emerald-400">
                        {row.dailyWage != null ? fmt(row.dailyWage) : '—'}
                      </td>
                      <td className="px-3 py-2.5 font-mono">{row.actualHours ?? '—'}</td>
                      <td className="px-3 py-2.5 text-xs text-zinc-400">{row.suggestedActionAr ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/admin/hr?tab=daily-payroll&branchId=${review.branchId}&workDate=${row.workDate}`}
                          className="text-xs text-primary hover:underline"
                        >
                          يوميات
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        {(() => {
                          const canAssign = canAssignDayAttendance(row, review.reviewThroughDate);
                          const canGenerate = canGenerateDayPayroll(row, review.reviewThroughDate);
                          const rowBusy =
                            assigningDay === row.workDate || generatingDay === row.workDate;

                          if (!canAssign && !canGenerate) {
                            return <span className="text-xs text-zinc-600">—</span>;
                          }

                          return (
                            <div className="flex flex-col items-start gap-1">
                              {canAssign && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs whitespace-nowrap"
                                  disabled={rowBusy || applying}
                                  onClick={() => assignDayAttendance(row.workDate)}
                                >
                                  {assigningDay === row.workDate ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" />
                                  ) : (
                                    <UserCheck className="w-3.5 h-3.5 ml-1" />
                                  )}
                                  تعيين الحضور
                                </Button>
                              )}
                              {canGenerate && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs whitespace-nowrap"
                                  disabled={rowBusy || applying}
                                  onClick={() => generateDayPayroll(row.workDate)}
                                >
                                  {generatingDay === row.workDate ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" />
                                  ) : (
                                    <Banknote className="w-3.5 h-3.5 ml-1" />
                                  )}
                                  توليد يومية
                                </Button>
                              )}
                              {rowFlash[row.workDate] && (
                                <span
                                  className={cn(
                                    'text-[10px] max-w-[140px] leading-tight',
                                    rowFlash[row.workDate].ok ? 'text-emerald-400' : 'text-rose-400',
                                  )}
                                >
                                  {rowFlash[row.workDate].message}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
