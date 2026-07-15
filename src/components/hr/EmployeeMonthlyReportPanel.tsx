'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Banknote,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  Loader2,
  MinusCircle,
  RefreshCw,
  Target,
  User,
  Wallet,
} from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  EMPLOYMENT_TYPE_LABELS,
  PAYROLL_METHOD_LABELS,
} from '@/lib/hr/employee-hr-model';
import type { EmployeeMonthlyPayrollReport } from '@/lib/reports/employee-monthly-payroll.types';
import {
  formatCurrencyAr,
  formatDurationAr,
  formatScheduleRangeAr,
  formatTime12hAr,
} from '@/lib/reports/reportFormatters';

interface EmployeeOption {
  EmpID: number;
  EmpName: string;
  Job?: string | null;
  isActive?: boolean | number;
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

const BADGE_CLASSES: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  danger: 'bg-red-500/15 text-red-300 border-red-500/30',
  muted: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  info: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  neutral: 'bg-zinc-600/15 text-zinc-300 border-zinc-600/30',
};

function StatusBadge({ label, variant }: { label: string; variant: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_CLASSES[variant] ?? BADGE_CLASSES.neutral}`}
    >
      {label}
    </span>
  );
}

function hoursLabel(hours: number | null | undefined): string {
  if (hours == null) return '—';
  const mins = Math.round(hours * 60);
  return formatDurationAr(mins);
}

function moneyOrDash(value: number | null | undefined): string {
  if (value == null) return '—';
  return formatCurrencyAr(value);
}

export default function EmployeeMonthlyReportPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cairoNow = getCairoNowParts();

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState(searchParams.get('employeeId') ?? '');
  const [year, setYear] = useState(Number(searchParams.get('year')) || cairoNow.year);
  const [month, setMonth] = useState(Number(searchParams.get('month')) || cairoNow.month);
  const [report, setReport] = useState<EmployeeMonthlyPayrollReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [onlyWorkDays, setOnlyWorkDays] = useState(false);

  const yearOptions = useMemo(() => {
    const current = cairoNow.year;
    return Array.from({ length: 8 }, (_, i) => current - 5 + i);
  }, [cairoNow.year]);

  const syncUrl = useCallback(
    (empId: string, y: number, m: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', 'monthly-report');
      if (empId) params.set('employeeId', empId);
      else params.delete('employeeId');
      params.set('year', String(y));
      params.set('month', String(m));
      router.replace(`/admin/hr?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const fetchReport = useCallback(async (empId: string, y: number, m: number) => {
    if (!empId) {
      setReport(null);
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
      const res = await fetch(`/api/admin/hr/employee-monthly-report?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل التقرير');
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'خطأ غير معروف');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setEmployeesLoading(true);
      try {
        const res = await fetch('/api/employees');
        const active: EmployeeOption[] = res.ok ? await res.json() : [];
        setEmployees(
          active
            .filter((e) => e.isActive === true || e.isActive === 1 || e.isActive == null)
            .sort((a, b) => a.EmpName.localeCompare(b.EmpName, 'ar')),
        );
      } catch {
        setEmployees([]);
      } finally {
        setEmployeesLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const urlEmp = searchParams.get('employeeId');
    const urlYear = Number(searchParams.get('year')) || cairoNow.year;
    const urlMonth = Number(searchParams.get('month')) || cairoNow.month;
    if (urlEmp) setEmployeeId(urlEmp);
    setYear(urlYear);
    setMonth(urlMonth);
    if (urlEmp) fetchReport(urlEmp, urlYear, urlMonth);
  }, [searchParams, fetchReport, cairoNow.year, cairoNow.month]);


  const handleApply = () => {
    syncUrl(employeeId, year, month);
    fetchReport(employeeId, year, month);
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
    setYear(newYear);
    setMonth(newMonth);
    syncUrl(employeeId, newYear, newMonth);
    if (employeeId) fetchReport(employeeId, newYear, newMonth);
  };

  const visibleDays = useMemo(() => {
    if (!report) return [];
    if (!onlyWorkDays) return report.days;
    return report.days.filter(
      (d) =>
        d.isScheduledWorkDay ||
        d.checkIn ||
        (d.baseWage != null && d.baseWage > 0) ||
        (d.targetAmount != null && d.targetAmount > 0) ||
        d.deductions > 0 ||
        d.advances > 0,
    );
  }, [report, onlyWorkDays]);

  const methodLabel = report?.employee.payrollMethod
    ? PAYROLL_METHOD_LABELS[
        report.employee.payrollMethod as keyof typeof PAYROLL_METHOD_LABELS
      ] ?? report.employee.payrollMethod
    : null;

  const employmentLabel = report?.employee.employmentType
    ? EMPLOYMENT_TYPE_LABELS[
        report.employee.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS
      ] ?? report.employee.employmentType
    : null;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Hero filter strip */}
      <div className="relative overflow-hidden rounded-2xl border border-[#D6A84F]/25 bg-gradient-to-l from-zinc-950 via-zinc-900 to-zinc-950">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, #D6A84F 0, transparent 40%), radial-gradient(circle at 80% 80%, #3b82f6 0, transparent 35%)',
          }}
        />
        <div className="relative p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[#D6A84F] text-xs font-medium mb-1">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                كشف شهري شامل
              </div>
              <h2 className="text-xl font-semibold text-zinc-50">تقرير الموظف الشهري</h2>
              <p className="text-sm text-zinc-400 mt-1 max-w-xl">
                حضور وانصراف · ساعات العمل · الأساسي اليومي · خصومات · تارجت — كل يوم في مكان واحد
              </p>
            </div>
            {report && (
              <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/70 px-4 py-3 text-left sm:text-right">
                <div className="text-lg font-semibold text-zinc-100">{report.employee.name}</div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {report.employee.job || '—'}
                  {employmentLabel ? ` · ${employmentLabel}` : ''}
                  {methodLabel ? ` · ${methodLabel}` : ''}
                </div>
                <div className="text-xs text-[#D6A84F]/90 mt-1 flex items-center gap-1 justify-end">
                  <Calendar className="h-3 w-3" />
                  {report.period.monthLabelAr}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1.5 lg:col-span-2">
              <label className="text-xs text-zinc-400">الموظف</label>
              <Select
                value={employeeId || undefined}
                onValueChange={setEmployeeId}
                disabled={employeesLoading}
              >
                <SelectTrigger className="bg-zinc-950/80 border-zinc-700">
                  <SelectValue
                    placeholder={employeesLoading ? 'جاري التحميل...' : 'اختر الموظف'}
                  />
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

            <div className="flex items-end gap-2">
              <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} title="الشهر السابق">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} title="الشهر التالي">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                onClick={handleApply}
                disabled={!employeeId || loading}
                className="flex-1 bg-[#D6A84F] hover:bg-[#c4983f] text-black"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 ml-1" />
                )}
                عرض
              </Button>
            </div>
          </div>

        </div>
      </div>

      {!employeeId && !loading && (
        <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950">
            <User className="h-7 w-7 text-zinc-500" />
          </div>
          <p className="text-zinc-300 font-medium">اختر الموظف عشان يظهر كشف الشهر</p>
          <p className="text-sm text-zinc-500 mt-1">الحضور · الأساسي · الخصومات · التارجت اليومي</p>
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

      {report && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard
              title="صافي الشهر"
              value={formatCurrencyAr(report.summary.monthNet)}
              icon={<Wallet className="h-5 w-5" />}
              variant="primary"
            />
            <KpiCard
              title="إجمالي الأساسي"
              value={formatCurrencyAr(report.summary.totalBaseWage)}
              icon={<Banknote className="h-5 w-5" />}
            />
            <KpiCard
              title="التارجت"
              value={formatCurrencyAr(report.summary.totalTargetAmount)}
              icon={<Target className="h-5 w-5" />}
            />
            <KpiCard
              title="الخصومات"
              value={formatCurrencyAr(report.summary.totalDeductions)}
              icon={<MinusCircle className="h-5 w-5" />}
              variant="warning"
            />
            <KpiCard
              title="ساعات العمل"
              value={hoursLabel(report.summary.totalActualHours)}
              icon={<Clock className="h-5 w-5" />}
            />
            <KpiCard
              title="أيام حضور / غياب"
              value={`${report.summary.attendanceDays} / ${report.summary.absentDays}`}
              icon={<Calendar className="h-5 w-5" />}
            />
          </div>

          {(report.summary.partialHourlyDays > 0 || report.summary.totalBaseShortfall > 0) && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
                <Clock className="h-4 w-4" />
                أيام ساعات ناقصة: {report.summary.partialHourlyDays}
              </span>
              <span className="text-zinc-500">|</span>
              <span className="text-amber-200/90">
                فرق الأساسي عن اليوم الكامل:{' '}
                <strong className="text-amber-100">
                  {formatCurrencyAr(report.summary.totalBaseShortfall)}
                </strong>
              </span>
              <span className="text-zinc-500 text-xs">
                (في نظام الساعة: اليوم الناقص بيتحسب بالمخدوم فعلًا)
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-sm">
            {[
              ['أيام مجدولة', String(report.summary.scheduledDays)],
              ['ساعات مجدولة', hoursLabel(report.summary.totalScheduledHours)],
              ['سلف الشهر', formatCurrencyAr(report.summary.totalAdvances)],
              ['مبيعات التارجت', formatCurrencyAr(report.summary.totalTargetSales)],
              ['انصراف ناقص', String(report.summary.incompleteAttendanceDays)],
              ['مرجع يوم كامل*', formatCurrencyAr(report.summary.totalFullDayBase)],
            ].map(([label, val]) => (
              <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
                <div className="text-zinc-500 text-xs">{label}</div>
                <div className="text-zinc-200 font-medium">{val}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-zinc-300">تفصيل الأيام</h3>
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyWorkDays}
                onChange={(e) => setOnlyWorkDays(e.target.checked)}
                className="rounded border-zinc-600"
              />
              إخفاء أيام الراحة الفارغة
            </label>
          </div>

          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1280px] text-sm">
                <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800">
                  <tr className="text-zinc-400 text-xs">
                    <th className="px-3 py-3 text-right font-medium">اليوم</th>
                    <th className="px-3 py-3 text-right font-medium">الموعد</th>
                    <th className="px-3 py-3 text-right font-medium">حضور</th>
                    <th className="px-3 py-3 text-right font-medium">انصراف</th>
                    <th className="px-3 py-3 text-right font-medium">ساعات</th>
                    <th className="px-3 py-3 text-right font-medium">الحالة</th>
                    <th className="px-3 py-3 text-right font-medium">الأساسي</th>
                    <th className="px-3 py-3 text-right font-medium min-w-[200px]">ملاحظة الأساسي</th>
                    <th className="px-3 py-3 text-right font-medium">خصم</th>
                    <th className="px-3 py-3 text-right font-medium">تارجت</th>
                    <th className="px-3 py-3 text-right font-medium">صافي اليوم</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDays.map((day) => {
                    const rowClass = [
                      'border-b border-zinc-800/80 transition-colors',
                      day.isDayOff && !day.checkIn ? 'bg-zinc-900/25 opacity-75' : '',
                      day.isPartialDay ? 'bg-amber-500/[0.06]' : '',
                      day.statusCode === 'absent' ? 'bg-red-500/[0.04]' : '',
                      day.isFutureDate ? 'opacity-50' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <tr key={day.date} className={rowClass}>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="text-zinc-200 font-medium">{day.dayNameAr}</div>
                          <div className="text-[11px] text-zinc-500 font-mono">{day.date}</div>
                        </td>
                        <td className="px-3 py-2.5 text-zinc-400 whitespace-nowrap text-xs">
                          {day.scheduledStart && day.scheduledEnd
                            ? formatScheduleRangeAr(day.scheduledStart, day.scheduledEnd)
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {formatTime12hAr(day.checkIn) ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {day.checkOutLabelAr ?? formatTime12hAr(day.checkOut) ?? '—'}
                          {day.breakMinutes > 0 && (
                            <div className="text-[10px] text-zinc-500">
                              مستقطع {day.breakMinutes}د
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={day.isPartialDay ? 'text-amber-300 font-medium' : 'text-zinc-200'}>
                            {hoursLabel(day.actualHours)}
                          </span>
                          {day.scheduledHours != null && day.actualHours != null && (
                            <div className="text-[10px] text-zinc-500">
                              من {hoursLabel(day.scheduledHours)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge label={day.statusLabelAr} variant={day.badgeVariant} />
                          {(day.lateMinutes > 0 || day.earlyLeaveMinutes > 0) && (
                            <div className="text-[10px] text-zinc-500 mt-1 space-x-1 space-x-reverse">
                              {day.lateMinutes > 0 && <span>تأخير {day.lateMinutes}د</span>}
                              {day.earlyLeaveMinutes > 0 && (
                                <span>انصراف مبكر {day.earlyLeaveMinutes}د</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div
                            className={`font-semibold ${day.isPartialDay ? 'text-amber-300' : 'text-zinc-100'}`}
                          >
                            {moneyOrDash(day.baseWage)}
                          </div>
                          {day.isPartialDay && day.fullDayBase != null && (
                            <div className="text-[10px] text-zinc-500 line-through">
                              {formatCurrencyAr(day.fullDayBase)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {day.baseWageNoteAr ? (
                            <span
                              className={`text-xs leading-relaxed ${
                                day.isPartialDay
                                  ? 'text-amber-200/90'
                                  : 'text-zinc-400'
                              }`}
                            >
                              {day.baseWageNoteAr}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {day.deductions > 0 ? (
                            <span className="text-rose-300 font-medium">
                              {formatCurrencyAr(day.deductions)}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                          {day.advances > 0 && (
                            <div className="text-[10px] text-orange-300/80">
                              سلفة {formatCurrencyAr(day.advances)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {day.targetAmount != null ? (
                            <>
                              <div className="text-emerald-300 font-medium">
                                {formatCurrencyAr(day.targetAmount)}
                              </div>
                              {day.targetSales != null && (
                                <div className="text-[10px] text-zinc-500">
                                  مبيعات {formatCurrencyAr(day.targetSales)}
                                </div>
                              )}
                            </>
                          ) : day.targetPersistence === 'not_generated' ? (
                            <span className="text-[11px] text-zinc-500">لم يُولَّد</span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-[#D6A84F]">
                          {day.isFutureDate ? '—' : formatCurrencyAr(day.dayNet)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-zinc-900/90 border-t border-zinc-700">
                  <tr className="text-xs text-zinc-300">
                    <td className="px-3 py-3 font-semibold" colSpan={4}>
                      إجمالي الشهر ({visibleDays.length} يوم معروض)
                    </td>
                    <td className="px-3 py-3 font-semibold">
                      {hoursLabel(report.summary.totalActualHours)}
                    </td>
                    <td />
                    <td className="px-3 py-3 font-semibold">
                      {formatCurrencyAr(report.summary.totalBaseWage)}
                    </td>
                    <td className="px-3 py-3 text-amber-200/80">
                      {report.summary.totalBaseShortfall > 0
                        ? `فرق ناقص ${formatCurrencyAr(report.summary.totalBaseShortfall)}`
                        : '—'}
                    </td>
                    <td className="px-3 py-3 font-semibold text-rose-300">
                      {formatCurrencyAr(report.summary.totalDeductions)}
                    </td>
                    <td className="px-3 py-3 font-semibold text-emerald-300">
                      {formatCurrencyAr(report.summary.totalTargetAmount)}
                    </td>
                    <td className="px-3 py-3 font-bold text-[#D6A84F]">
                      {formatCurrencyAr(report.summary.monthNet)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-zinc-500 leading-relaxed">
            * مرجع اليوم الكامل = سعر الساعة × الساعات المجدولة (أو اليومية الثابتة). صافي اليوم =
            الأساسي + التارجت − الخصومات − السلف المسجّلة في دفتر الموظف لنفس التاريخ.
          </p>
        </>
      )}

    </div>
  );
}
