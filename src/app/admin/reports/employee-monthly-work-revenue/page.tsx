'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Printer,
  RefreshCw,
  TrendingUp,
  Clock,
  User,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { EmployeeMonthlyWorkRevenueReport } from '@/lib/reports/employee-monthly-work-revenue.types';
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
  success: 'bg-success-soft text-success border-success/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
  danger: 'bg-destructive-soft text-destructive border-destructive/30',
  muted: 'bg-muted text-muted-foreground border-border',
  info: 'bg-info-soft text-info border-info/30',
  neutral: 'bg-muted text-foreground border-border',
};

function StatusBadge({ label, variant }: { label: string; variant: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_CLASSES[variant] ?? BADGE_CLASSES.neutral}`}>
      {label}
    </span>
  );
}

function isWeekendDate(dateStr: string): boolean {
  const dow = new Date(`${dateStr}T12:00:00Z`).getDay();
  return dow === 5 || dow === 6;
}

export default function EmployeeMonthlyWorkRevenuePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cairoNow = getCairoNowParts();

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState(searchParams.get('employeeId') ?? '');
  const [year, setYear] = useState(Number(searchParams.get('year')) || cairoNow.year);
  const [month, setMonth] = useState(Number(searchParams.get('month')) || cairoNow.month);
  const [report, setReport] = useState<EmployeeMonthlyWorkRevenueReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employeesLoading, setEmployeesLoading] = useState(true);

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
      router.replace(`/admin/reports/employee-monthly-work-revenue?${params.toString()}`, { scroll: false });
    },
    [router],
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
      const params = new URLSearchParams({ employeeId: empId, year: String(y), month: String(m) });
      const res = await fetch(`/api/admin/reports/employee-monthly-work-revenue?${params}`);
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
        const [activeRes, inactiveRes] = await Promise.all([
          fetch('/api/employees'),
          fetch('/api/employees?inactive=true'),
        ]);
        const active: EmployeeOption[] = activeRes.ok ? await activeRes.json() : [];
        const inactive: EmployeeOption[] = inactiveRes.ok ? await inactiveRes.json() : [];
        const map = new Map<number, EmployeeOption>();
        for (const e of [...active, ...inactive]) map.set(e.EmpID, e);
        setEmployees([...map.values()].sort((a, b) => a.EmpName.localeCompare(b.EmpName, 'ar')));
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
    if (newMonth < 1) { newMonth = 12; newYear -= 1; }
    if (newMonth > 12) { newMonth = 1; newYear += 1; }
    setYear(newYear);
    setMonth(newMonth);
    syncUrl(employeeId, newYear, newMonth);
    if (employeeId) fetchReport(employeeId, newYear, newMonth);
  };

  const handlePrint = () => {
    if (!employeeId) return;
    const params = new URLSearchParams({ employeeId, year: String(year), month: String(month) });
    window.open(`/admin/reports/employee-monthly-work-revenue/print?${params}`, '_blank');
  };

  const selectedEmployee = employees.find((e) => String(e.EmpID) === employeeId);

  return (
    <div className="space-y-6 pb-10" dir="rtl">
      <PageHeader
        title="تقرير مواعيد العمل والإيرادات الشهرية"
        description="جدول يومي يجمع مواعيد العمل، الحضور، والإيرادات لموظف واحد"
      />

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">الموظف</label>
            <Select value={employeeId || undefined} onValueChange={setEmployeeId} disabled={employeesLoading}>
              <SelectTrigger className="bg-background border-border">
                <SelectValue placeholder={employeesLoading ? 'جاري التحميل...' : 'اختر موظفًا'} />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.EmpID} value={String(e.EmpID)}>
                    {e.EmpName}
                    {!e.isActive && e.isActive !== 1 ? ' (غير نشط)' : ''}
                  </SelectItem>
                ))}
                {employeeId && !selectedEmployee && (
                  <SelectItem value={employeeId}>موظف #{employeeId}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">الشهر</label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">السنة</label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end gap-2 flex-wrap">
            <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} title="الشهر السابق">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} title="الشهر التالي">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button onClick={handleApply} disabled={!employeeId || loading} className="flex-1 min-w-[120px] bg-primary hover:bg-primary-hover text-primary-foreground">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
              عرض التقرير
            </Button>
            <Button variant="outline" onClick={handlePrint} disabled={!employeeId || !report} className="min-w-[140px]">
              <Printer className="h-4 w-4 ml-1" />
              طباعة / حفظ PDF
            </Button>
          </div>
        </div>
      </div>

      {!employeeId && (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
          <User className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p>اختر موظفًا ثم اضغط «عرض التقرير» لعرض جدول الشهر.</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive-soft p-4 flex items-start gap-3 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{error}</p>
            {employeeId && (
              <Button variant="link" className="text-destructive p-0 h-auto mt-2" onClick={handleApply}>
                إعادة المحاولة
              </Button>
            )}
          </div>
        </div>
      )}

      {loading && employeeId && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin ml-3" />
          جاري تحميل التقرير...
        </div>
      )}

      {report && !loading && (
        <>
          <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap gap-4 items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{report.employee.name}</h2>
              <p className="text-sm text-muted-foreground">
                {report.employee.job || '—'} · {report.period.monthLabelAr}
                {!report.employee.isActive && (
                  <span className="mr-2 text-warning">(موظف غير نشط)</span>
                )}
              </p>
            </div>
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {report.period.startDate} — {report.period.endDate}
            </div>
          </div>

          {/* Primary summary */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <KpiCard title="إجمالي الإيراد" value={formatCurrencyAr(report.summary.totalRevenue)} icon={<TrendingUp className="h-5 w-5" />} variant="primary" />
            <KpiCard title="أيام العمل المجدولة" value={String(report.summary.scheduledDays)} icon={<Calendar className="h-5 w-5" />} />
            <KpiCard title="أيام الحضور" value={String(report.summary.attendanceDays)} icon={<User className="h-5 w-5" />} />
            <KpiCard title="ساعات العمل الفعلية" value={formatDurationAr(report.summary.workedMinutes)} icon={<Clock className="h-5 w-5" />} />
            <KpiCard title="إجمالي التأخير" value={formatDurationAr(report.summary.lateMinutes)} icon={<Clock className="h-5 w-5" />} variant="warning" />
            <KpiCard title="متوسط الإيراد/يوم حضور" value={formatCurrencyAr(report.summary.averageRevenuePerAttendanceDay)} icon={<TrendingUp className="h-5 w-5" />} />
          </div>

          {/* Secondary summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-sm">
            {[
              ['ساعات مجدولة', formatDurationAr(report.summary.scheduledMinutes)],
              ['انصراف مبكر', formatDurationAr(report.summary.earlyLeaveMinutes)],
              ['أيام غياب', String(report.summary.absentDays)],
              ['حضور غير مكتمل', String(report.summary.incompleteAttendanceDays)],
              ['إجمالي الخدمات', String(report.summary.totalServiceLines)],
              ['إجمالي الفواتير', String(report.summary.totalInvoices)],
            ].map(([label, val]) => (
              <div key={label} className="rounded-lg border border-border bg-background px-3 py-2">
                <div className="text-muted-foreground text-xs">{label}</div>
                <div className="text-foreground font-medium">{val}</div>
              </div>
            ))}
          </div>

          {/* Daily table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="sticky top-0 z-10 bg-card border-b border-border">
                  <tr className="text-muted-foreground text-xs">
                    <th className="px-3 py-3 text-right font-medium">اليوم</th>
                    <th className="px-3 py-3 text-right font-medium">التاريخ</th>
                    <th className="px-3 py-3 text-right font-medium">موعد العمل المخطط</th>
                    <th className="px-3 py-3 text-right font-medium">الحضور</th>
                    <th className="px-3 py-3 text-right font-medium">الانصراف</th>
                    <th className="px-3 py-3 text-right font-medium">ساعات العمل</th>
                    <th className="px-3 py-3 text-right font-medium">التأخير</th>
                    <th className="px-3 py-3 text-right font-medium">الانصراف المبكر</th>
                    <th className="px-3 py-3 text-right font-medium">الحالة</th>
                    <th className="px-3 py-3 text-right font-medium">الخدمات</th>
                    <th className="px-3 py-3 text-right font-medium">الفواتير</th>
                    <th className="px-3 py-3 text-right font-medium">إيراد اليوم</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((day) => {
                    const weekend = isWeekendDate(day.date);
                    const rowClass = [
                      'border-b border-border',
                      day.isDayOff ? 'bg-card opacity-80' : '',
                      day.statusCode === 'incomplete_checkout' ? 'bg-warning-soft' : '',
                      weekend ? 'bg-background' : '',
                    ].filter(Boolean).join(' ');

                    return (
                      <tr key={day.date} className={rowClass}>
                        <td className="px-3 py-2.5 text-foreground whitespace-nowrap">{day.dayNameAr}</td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap font-mono text-xs">{day.date}</td>
                        <td className="px-3 py-2.5 text-foreground whitespace-nowrap">
                          {day.scheduledStart && day.scheduledEnd
                            ? formatScheduleRangeAr(day.scheduledStart, day.scheduledEnd)
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{formatTime12hAr(day.checkIn) ?? '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {day.checkOutLabelAr ?? formatTime12hAr(day.checkOut) ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{formatDurationAr(day.workedMinutes)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{day.lateMinutes > 0 ? formatDurationAr(day.lateMinutes) : '0'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{day.earlyLeaveMinutes > 0 ? formatDurationAr(day.earlyLeaveMinutes) : '0'}</td>
                        <td className="px-3 py-2.5">
                          <StatusBadge label={day.statusLabelAr} variant={day.badgeVariant} />
                        </td>
                        <td className="px-3 py-2.5 text-center">{day.serviceCount}</td>
                        <td className="px-3 py-2.5 text-center">{day.invoiceCount}</td>
                        <td className="px-3 py-2.5 font-semibold text-brand whitespace-nowrap">
                          {formatCurrencyAr(day.revenue)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
