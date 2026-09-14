'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  User,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SmartAttendanceFixDialog from '@/components/hr/SmartAttendanceFixDialog';
import type { EmployeeMonthlySheetReport } from '@/lib/reports/employee-monthly-sheet.types';
import {
  formatCurrencyAr,
  formatTime12hAr,
} from '@/lib/reports/reportFormatters';
import { shortBranchName } from '@/lib/hr/dailyPayrollClosingUi';

interface EmployeeOption {
  EmpID: number;
  EmpName: string;
  Job?: string | null;
  isActive?: boolean | number;
}

interface BranchOption {
  branchId: number;
  branchCode: string;
  branchName: string;
}

function getCairoNowParts(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value),
  };
}

const MONTHS = [
  { value: 1, label: 'يناير' },
  { value: 2, label: 'فبراير' },
  { value: 3, label: 'مارس' },
  { value: 4, label: 'أبريل' },
  { value: 5, label: 'مايو' },
  { value: 6, label: 'يونيو' },
  { value: 7, label: 'يوليو' },
  { value: 8, label: 'أغسطس' },
  { value: 9, label: 'سبتمبر' },
  { value: 10, label: 'أكتوبر' },
  { value: 11, label: 'نوفمبر' },
  { value: 12, label: 'ديسمبر' },
];

function moneyOrDash(value: number | null | undefined): string {
  if (value == null) return '—';
  return formatCurrencyAr(value);
}

function dayLabelAr(dayNumber: number, month: number): string {
  const monthName = MONTHS.find((m) => m.value === month)?.label ?? '';
  return `${dayNumber} ${monthName}`;
}

type CompletePreview = {
  workDate: string;
  message: string;
  proposedCheckIn: string | null;
  proposedCheckOut: string | null;
  canApply: boolean;
  willFillCheckIn: boolean;
  willFillCheckOut: boolean;
};

const actionPillClass =
  'w-full rounded-full bg-amber-400 hover:bg-amber-300 text-black text-[12px] font-semibold leading-snug px-3 py-2.5 disabled:opacity-50 disabled:pointer-events-none';

export default function EmployeeMonthlySheetPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cairoNow = getCairoNowParts();

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [employeeId, setEmployeeId] = useState(searchParams.get('employeeId') ?? '');
  const [year, setYear] = useState(Number(searchParams.get('year')) || cairoNow.year);
  const [month, setMonth] = useState(Number(searchParams.get('month')) || cairoNow.month);
  const [sheet, setSheet] = useState<EmployeeMonthlySheetReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [sessionBranchId, setSessionBranchId] = useState<number | null>(null);
  const [actionBusyDate, setActionBusyDate] = useState<string | null>(null);
  const [flashMsg, setFlashMsg] = useState('');
  const [completePreview, setCompletePreview] = useState<CompletePreview | null>(null);
  const [completeConfirming, setCompleteConfirming] = useState(false);
  const [attendanceFix, setAttendanceFix] = useState<{
    workDate: string;
    branchId: number;
  } | null>(null);

  const yearOptions = useMemo(() => {
    const current = cairoNow.year;
    return Array.from({ length: 8 }, (_, i) => current - 5 + i);
  }, [cairoNow.year]);

  const syncUrl = useCallback(
    (empId: string, y: number, m: number) => {
      const params = new URLSearchParams();
      if (empId) params.set('employeeId', empId);
      params.set('year', String(y));
      params.set('month', String(m));
      router.replace(`/admin/hr/employee-monthly-sheet?${params.toString()}`, { scroll: false });
    },
    [router],
  );

  const fetchSheet = useCallback(async (empId: string, y: number, m: number) => {
    if (!empId) {
      setSheet(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        employeeId: empId,
        year: String(y),
        month: String(m),
      });
      const res = await fetch(`/api/admin/hr/employee-monthly-sheet?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل التقرير');
      setSheet(data);
      if (data.branch?.branchId) setSessionBranchId(Number(data.branch.branchId));
    } catch (err) {
      setSheet(null);
      setError(err instanceof Error ? err.message : 'خطأ غير معروف');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setEmployeesLoading(true);
      try {
        const [empRes, activeRes, availableRes] = await Promise.all([
          fetch('/api/employees'),
          fetch('/api/branches/active'),
          fetch('/api/branches/available'),
        ]);
        const activeEmps: EmployeeOption[] = empRes.ok ? await empRes.json() : [];
        setEmployees(
          activeEmps
            .filter((e) => e.isActive === true || e.isActive === 1 || e.isActive == null)
            .sort((a, b) => a.EmpName.localeCompare(b.EmpName, 'ar')),
        );

        const activeData = activeRes.ok ? await activeRes.json() : null;
        const availableData = availableRes.ok ? await availableRes.json() : null;

        type RawBranch = {
          BranchID?: number;
          branchId?: number;
          BranchCode?: string;
          branchCode?: string;
          BranchName?: string;
          branchName?: string;
        };

        const rawList: RawBranch[] = Array.isArray(availableData?.branches)
          ? availableData.branches
          : activeData?.activeBranch
            ? [activeData.activeBranch]
            : [];

        const list: BranchOption[] = rawList
          .map((b) => ({
            branchId: Number(b.branchId ?? b.BranchID),
            branchCode: String(b.branchCode ?? b.BranchCode ?? ''),
            branchName: String(b.branchName ?? b.BranchName ?? ''),
          }))
          .filter((b) => Number.isFinite(b.branchId) && b.branchId > 0);
        setBranches(list);

        const sessionId =
          activeData?.activeBranch?.BranchID ??
          activeData?.activeBranch?.branchId ??
          list[0]?.branchId ??
          null;
        if (sessionId) setSessionBranchId(Number(sessionId));
      } catch {
        setEmployees([]);
      } finally {
        setEmployeesLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const urlEmp = searchParams.get('employeeId') ?? '';
    const urlYear = Number(searchParams.get('year')) || cairoNow.year;
    const urlMonth = Number(searchParams.get('month')) || cairoNow.month;
    if (urlEmp) setEmployeeId(urlEmp);
    setYear(urlYear);
    setMonth(urlMonth);
    if (urlEmp) void fetchSheet(urlEmp, urlYear, urlMonth);
  }, [searchParams, fetchSheet, cairoNow.year, cairoNow.month]);

  const ensureSessionBranch = useCallback(
    async (branchId: number) => {
      if (sessionBranchId === branchId) return true;
      try {
        const res = await fetch('/api/auth/switch-branch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branchId }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.message || data.error || 'تعذر تبديل الفرع');
        }
        setSessionBranchId(branchId);
        return true;
      } catch {
        return false;
      }
    },
    [sessionBranchId],
  );

  const flash = (msg: string) => {
    setFlashMsg(msg);
    setTimeout(() => setFlashMsg(''), 6000);
  };

  const handleApply = () => {
    syncUrl(employeeId, year, month);
    void fetchSheet(employeeId, year, month);
  };

  const shiftMonth = (delta: number) => {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    setMonth(newMonth);
    setYear(newYear);
    if (employeeId) {
      syncUrl(employeeId, newYear, newMonth);
      void fetchSheet(employeeId, newYear, newMonth);
    }
  };

  const switchBranch = async (branchId: number) => {
    const ok = await ensureSessionBranch(branchId);
    if (!ok) {
      flash('تعذر تبديل الفرع');
      return;
    }
    if (employeeId) void fetchSheet(employeeId, year, month);
  };

  const previewCompleteAttendance = async (workDate: string, branchId: number) => {
    setActionBusyDate(workDate);
    try {
      const switched = await ensureSessionBranch(branchId);
      if (!switched) {
        flash('تعذر تبديل الفرع لإكمال الحضور');
        return;
      }
      const res = await fetch('/api/admin/hr/employee-monthly-sheet/complete-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: Number(employeeId),
          workDate,
          confirm: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر معاينة إكمال الحضور');
      if (!data.canApply) {
        flash(data.message || 'لا يمكن إكمال الحضور لهذا اليوم');
        return;
      }
      setCompletePreview({
        workDate,
        message: data.message,
        proposedCheckIn: data.proposedCheckIn,
        proposedCheckOut: data.proposedCheckOut,
        canApply: data.canApply,
        willFillCheckIn: data.willFillCheckIn,
        willFillCheckOut: data.willFillCheckOut,
      });
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'تعذر معاينة إكمال الحضور');
    } finally {
      setActionBusyDate(null);
    }
  };

  const confirmCompleteAttendance = async () => {
    if (!completePreview || !employeeId) return;
    setCompleteConfirming(true);
    try {
      const res = await fetch('/api/admin/hr/employee-monthly-sheet/complete-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: Number(employeeId),
          workDate: completePreview.workDate,
          confirm: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر إكمال الحضور');
      setCompletePreview(null);
      flash(data.message || 'تم إكمال الحضور');
      await fetchSheet(employeeId, year, month);
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'تعذر إكمال الحضور');
    } finally {
      setCompleteConfirming(false);
    }
  };

  const generateDailyPayroll = async (workDate: string, branchId: number, exists: boolean) => {
    setActionBusyDate(workDate);
    try {
      const switched = await ensureSessionBranch(branchId);
      if (!switched) {
        flash('تعذر تبديل الفرع لتوليد اليومية');
        return;
      }
      const res = await fetch('/api/payroll/daily/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDate,
          empIds: [Number(employeeId)],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || (exists ? 'تعذر إعادة توليد اليومية' : 'تعذر توليد اليومية'));
      }
      flash(
        exists
          ? `تمت إعادة توليد اليومية (${data.generatedCount ?? 0} سجل)`
          : `تم توليد اليومية (${data.generatedCount ?? 0} سجل)`,
      );
      await fetchSheet(employeeId, year, month);
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : 'تعذر توليد اليومية');
    } finally {
      setActionBusyDate(null);
    }
  };

  const refreshAfterAttendanceFix = async (workDate: string, branchId: number) => {
    if (!employeeId) return;
    setActionBusyDate(workDate);
    try {
      const switched = await ensureSessionBranch(branchId);
      if (switched) {
        await fetch('/api/payroll/daily/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workDate,
            empIds: [Number(employeeId)],
          }),
        });
      }
      flash('تم تحديث الحضور');
      await fetchSheet(employeeId, year, month);
    } finally {
      setActionBusyDate(null);
    }
  };

  const activeBranchId = sheet?.branch.branchId ?? sessionBranchId;

  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader
        title="تقرير الموظف الشهري"
        description="كشف شهري يومًا بيوم — حضور · إيرادات · مصاريف · يوميات"
      />

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1.5 lg:col-span-2">
            <label className="text-xs text-zinc-400">الموظف</label>
            <Select
              value={employeeId || undefined}
              onValueChange={setEmployeeId}
              disabled={employeesLoading}
            >
              <SelectTrigger className="bg-zinc-950/80 border-zinc-700">
                <SelectValue placeholder={employeesLoading ? 'جاري التحميل...' : 'اختر الموظف'} />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.EmpID} value={String(e.EmpID)}>
                    {e.EmpName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">الشهر</label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="bg-zinc-950/80 border-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">السنة</label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="bg-zinc-950/80 border-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {branches.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">الفرع</label>
              <Select
                value={sessionBranchId ? String(sessionBranchId) : undefined}
                onValueChange={(v) => void switchBranch(Number(v))}
              >
                <SelectTrigger className="bg-zinc-950/80 border-zinc-700">
                  <SelectValue placeholder="الفرع" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.branchId} value={String(b.branchId)}>
                      {shortBranchName({
                        branchCode: b.branchCode || '—',
                        branchName: b.branchName || b.branchCode || '—',
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} title="الشهر السابق">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} title="الشهر التالي">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            onClick={handleApply}
            disabled={!employeeId || loading}
            className="bg-amber-400 hover:bg-amber-300 text-black font-semibold"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
            عرض الشهر
          </Button>
          {sheet && (
            <span className="text-xs text-zinc-500 flex items-center gap-1 mr-2">
              <Calendar className="h-3.5 w-3.5" />
              {sheet.employee.name} · {sheet.period.monthLabelAr}
            </span>
          )}
        </div>
      </div>

      {flashMsg && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {flashMsg}
        </div>
      )}

      {!employeeId && !loading && (
        <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950">
            <User className="h-7 w-7 text-zinc-500" />
          </div>
          <p className="text-zinc-300 font-medium">اختر الموظف لعرض كشف الشهر</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3 text-red-300">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p>{error}</p>
            {employeeId && (
              <Button variant="link" className="text-red-200 p-0 h-auto mt-2" onClick={handleApply}>
                إعادة المحاولة
              </Button>
            )}
          </div>
        </div>
      )}

      {loading && employeeId && (
        <div className="flex items-center justify-center py-16 text-zinc-400">
          <Loader2 className="h-7 w-7 animate-spin ml-3" />
          جاري تجهيز كشف الشهر...
        </div>
      )}

      {sheet && !loading && (
        <div className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-950/40">
          <div className="overflow-x-auto max-h-[78vh] overflow-y-auto">
            <table className="w-full min-w-[1100px] text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-700">
                <tr className="text-zinc-300 text-xs">
                  <th className="px-3 py-3.5 text-right font-semibold w-[120px]">اليوم</th>
                  <th className="px-3 py-3.5 text-center font-semibold w-[120px]">ميعاد الحضور</th>
                  <th className="px-3 py-3.5 text-center font-semibold w-[120px]">ميعاد الانصراف</th>
                  <th className="px-3 py-3.5 text-center font-semibold min-w-[280px] w-[320px]">
                    الإجراءات
                  </th>
                  <th className="px-3 py-3.5 text-left font-semibold w-[130px]">إيرادات اليوم</th>
                  <th className="px-3 py-3.5 text-left font-semibold w-[130px]">مصاريف في اليوم</th>
                </tr>
              </thead>
              <tbody>
                {sheet.days.map((day) => {
                  const branchForDay =
                    day.attendance.attendanceBranchId || activeBranchId || sessionBranchId;
                  const busy = actionBusyDate === day.date;
                  const checkInDisplay =
                    day.attendance.statusCode === 'absent'
                      ? 'غياب'
                      : day.attendance.statusCode === 'day_off' && !day.attendance.checkIn
                        ? 'إجازة'
                        : formatTime12hAr(day.attendance.checkIn) ?? '—';
                  const checkOutDisplay =
                    day.attendance.statusCode === 'absent' ||
                    (day.attendance.statusCode === 'day_off' && !day.attendance.checkIn)
                      ? '—'
                      : formatTime12hAr(day.attendance.checkOut) ?? '—';

                  const rowClass = [
                    'border-b border-zinc-800/80 h-[118px]',
                    day.isToday ? 'bg-amber-500/[0.07]' : '',
                    day.isFutureDate ? 'opacity-45' : '',
                    day.attendance.statusCode === 'absent' ? 'bg-red-500/[0.04]' : '',
                    day.isDayOff && !day.attendance.checkIn ? 'bg-zinc-900/30' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <tr key={day.date} className={rowClass}>
                      <td className="px-3 py-3 align-middle whitespace-nowrap">
                        <div className="text-zinc-100 font-semibold">
                          {dayLabelAr(day.dayNumber, sheet.period.month)}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">{day.dayNameAr}</div>
                        {day.isToday && (
                          <div className="text-[10px] text-amber-300 mt-1">اليوم</div>
                        )}
                      </td>
                      <td className="px-3 py-3 align-middle text-center tabular-nums text-zinc-100">
                        {checkInDisplay}
                      </td>
                      <td className="px-3 py-3 align-middle text-center tabular-nums text-zinc-100">
                        {checkOutDisplay}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex flex-col items-stretch gap-2 max-w-[300px] mx-auto">
                          <button
                            type="button"
                            className={actionPillClass}
                            disabled={
                              busy || day.isFutureDate || !day.canAutoCompleteAttendance || !branchForDay
                            }
                            onClick={() =>
                              branchForDay &&
                              void previewCompleteAttendance(day.date, Number(branchForDay))
                            }
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin inline-block" />
                            ) : (
                              'اكمال بيانات الحضور والانصراف تلقائيا'
                            )}
                          </button>
                          <button
                            type="button"
                            className={actionPillClass}
                            disabled={busy || !day.canGeneratePayroll || !branchForDay}
                            onClick={() =>
                              branchForDay &&
                              void generateDailyPayroll(
                                day.date,
                                Number(branchForDay),
                                day.dailyPayroll.exists,
                              )
                            }
                          >
                            {day.dailyPayroll.exists
                              ? 'إعادة توليد اليومية'
                              : 'توليد اليوميات لهذا اليوم'}
                          </button>
                          <div className="flex justify-center pt-0.5">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="h-8 min-w-[2.5rem] rounded-full border border-zinc-600 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 text-sm font-bold tracking-widest"
                                  disabled={!day.canEditAttendance || !branchForDay}
                                  aria-label="إجراءات إضافية"
                                >
                                  ..
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="center" className="min-w-[180px]">
                                <DropdownMenuItem
                                  disabled={!day.canEditAttendance || !branchForDay}
                                  onClick={() =>
                                    branchForDay &&
                                    setAttendanceFix({
                                      workDate: day.date,
                                      branchId: Number(branchForDay),
                                    })
                                  }
                                >
                                  تعديل الحضور يدوياً
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-middle text-left tabular-nums text-emerald-300/90 font-medium">
                        {moneyOrDash(day.dailyRevenue)}
                      </td>
                      <td className="px-3 py-3 align-middle text-left tabular-nums text-rose-300/90 font-medium">
                        {moneyOrDash(day.dailyExpenses)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 bg-zinc-900 border-t-2 border-zinc-600">
                <tr className="text-sm">
                  <td className="px-3 py-4 text-zinc-400" colSpan={4}>
                    إجمالي الشهر — {sheet.days.length} يوم
                  </td>
                  <td className="px-3 py-4 text-left align-top">
                    <div className="text-[10px] text-zinc-500 mb-0.5">إجمالي إيرادات الشهر</div>
                    <div className="tabular-nums font-bold text-emerald-300">
                      {formatCurrencyAr(sheet.totals.revenue)}
                    </div>
                  </td>
                  <td className="px-3 py-4 text-left align-top">
                    <div className="text-[10px] text-zinc-500 mb-0.5">إجمالي مصاريف الشهر</div>
                    <div className="tabular-nums font-bold text-rose-300">
                      {formatCurrencyAr(sheet.totals.expenses)}
                    </div>
                  </td>
                </tr>
                <tr className="text-sm border-t border-zinc-700/80">
                  <td className="px-3 py-3 text-zinc-500" colSpan={4} />
                  <td className="px-3 py-3 text-left" colSpan={2}>
                    <div className="inline-flex flex-col items-start rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                      <div className="text-[10px] text-zinc-500 mb-0.5">صافي الموظف</div>
                      <div className="tabular-nums font-bold text-amber-300 text-base">
                        {formatCurrencyAr(sheet.totals.employeeNet)}
                      </div>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="px-4 py-3 text-[11px] text-zinc-500 border-t border-zinc-800 leading-relaxed">
            إيرادات اليوم = المبيعات المخصّصة بعد خصم الفاتورة · مصاريف اليوم = سلف وخصومات دفتر
            الموظف لنفس التاريخ · صافي الموظف = أساسي + تارجت − سلف − خصومات (من كشف الرواتب) — وليس
            إيراد ناقص مصروف.
          </p>
        </div>
      )}

      <Dialog open={Boolean(completePreview)} onOpenChange={(o) => !o && setCompletePreview(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تأكيد إكمال الحضور</DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm">
              سيتم تعبئة الأوقات الناقصة فقط من الإعدادات الافتراضية — بدون استبدال أوقات موجودة.
            </DialogDescription>
          </DialogHeader>
          {completePreview && (
            <div className="space-y-2 text-sm">
              <p className="text-zinc-200">{completePreview.message}</p>
              <div className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 tabular-nums">
                <div>
                  حضور:{' '}
                  <span className="text-amber-300">
                    {formatTime12hAr(completePreview.proposedCheckIn) ?? '—'}
                  </span>
                  {completePreview.willFillCheckIn && (
                    <span className="text-[10px] text-zinc-500 mr-2">جديد</span>
                  )}
                </div>
                <div className="mt-1">
                  انصراف:{' '}
                  <span className="text-amber-300">
                    {formatTime12hAr(completePreview.proposedCheckOut) ?? '—'}
                  </span>
                  {completePreview.willFillCheckOut && (
                    <span className="text-[10px] text-zinc-500 mr-2">جديد</span>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setCompletePreview(null)} disabled={completeConfirming}>
              إلغاء
            </Button>
            <Button
              className="bg-amber-400 hover:bg-amber-300 text-black font-semibold"
              disabled={!completePreview?.canApply || completeConfirming}
              onClick={() => void confirmCompleteAttendance()}
            >
              {completeConfirming ? <Loader2 className="h-4 w-4 animate-spin" /> : 'تأكيد الإكمال'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {attendanceFix && sheet && (
        <SmartAttendanceFixDialog
          open={Boolean(attendanceFix)}
          onOpenChange={(open) => {
            if (!open) setAttendanceFix(null);
          }}
          branchId={attendanceFix.branchId}
          workDate={attendanceFix.workDate}
          empId={sheet.employee.id}
          empName={sheet.employee.name}
          ensureSessionBranch={ensureSessionBranch}
          onSaved={() =>
            void refreshAfterAttendanceFix(attendanceFix.workDate, attendanceFix.branchId)
          }
        />
      )}
    </div>
  );
}
