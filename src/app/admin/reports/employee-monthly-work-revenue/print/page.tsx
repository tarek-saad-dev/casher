import { redirect } from 'next/navigation';
import PageGuard from '@/components/guards/PageGuard';
import { getEmployeeMonthlyWorkRevenueReport } from '@/lib/reports/employee-monthly-work-revenue';
import { validateReportParams } from '@/lib/reports/employee-monthly-work-revenue.types';
import {
  formatCurrencyAr,
  formatDurationAr,
  formatScheduleRangeAr,
  formatTime12hAr,
  getCairoGeneratedAtLabel,
  sanitizeFilenamePart,
} from '@/lib/reports/reportFormatters';
import AutoPrint from './AutoPrint';
import './print.css';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function EmployeeMonthlyWorkRevenuePrintPage({ searchParams }: Props) {
  const params = await searchParams;
  const validated = validateReportParams(
    pickParam(params.employeeId),
    pickParam(params.year),
    pickParam(params.month),
  );

  if (!validated.ok) {
    redirect('/admin/reports/employee-monthly-work-revenue');
  }

  const report = await getEmployeeMonthlyWorkRevenueReport({
    employeeId: validated.employeeId,
    year: validated.year,
    month: validated.month,
  });

  if (!report) {
    redirect('/admin/reports/employee-monthly-work-revenue');
  }

  const filename = `employee-work-revenue-${sanitizeFilenamePart(report.employee.name)}-${validated.year}-${String(validated.month).padStart(2, '0')}.pdf`;
  const generatedAt = getCairoGeneratedAtLabel();

  return (
    <PageGuard requiredPagePath="/admin/reports/employee-monthly-work-revenue">
      <>
        <AutoPrint filename={filename} />
        <div className="emp-work-print-report">
          <div className="emp-work-print-header">
            <div className="emp-work-print-logo-block">
              <div className="emp-work-print-logo-circle">CUT</div>
              <div>
                <div className="emp-work-print-brand-title">Cut Salon</div>
                <div className="emp-work-print-report-title">تقرير مواعيد العمل والإيرادات الشهرية</div>
              </div>
            </div>
            <div className="emp-work-print-meta">
              <div><strong>{report.employee.name}</strong></div>
              <div>{report.employee.job || '—'}</div>
              <div>{report.period.monthLabelAr}</div>
              <div>تاريخ الإنشاء: {generatedAt}</div>
            </div>
          </div>

          <table className="emp-work-print-summary-table">
            <thead>
              <tr>
                <th>إجمالي الإيراد</th>
                <th>أيام مجدولة</th>
                <th>أيام حضور</th>
                <th>ساعات فعلية</th>
                <th>إجمالي التأخير</th>
                <th>متوسط الإيراد/حضور</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatCurrencyAr(report.summary.totalRevenue)}</td>
                <td>{report.summary.scheduledDays}</td>
                <td>{report.summary.attendanceDays}</td>
                <td>{formatDurationAr(report.summary.workedMinutes)}</td>
                <td>{formatDurationAr(report.summary.lateMinutes)}</td>
                <td>{formatCurrencyAr(report.summary.averageRevenuePerAttendanceDay)}</td>
              </tr>
            </tbody>
          </table>

          <table className="emp-work-print-data-table">
            <thead>
              <tr>
                <th>اليوم</th>
                <th>التاريخ</th>
                <th>المخطط</th>
                <th>الحضور</th>
                <th>الانصراف</th>
                <th>الساعات</th>
                <th>الحالة</th>
                <th>التأخير</th>
                <th>الإيراد</th>
              </tr>
            </thead>
            <tbody>
              {report.days.map((day) => {
                const rowClass = [
                  day.isDayOff ? 'emp-work-print-day-off-row' : '',
                  day.statusCode === 'incomplete_checkout' ? 'emp-work-print-incomplete-row' : '',
                ].filter(Boolean).join(' ');

                return (
                  <tr key={day.date} className={rowClass || undefined}>
                    <td>{day.dayNameAr}</td>
                    <td>{day.date.slice(8, 10)}</td>
                    <td>
                      {day.scheduledStart && day.scheduledEnd
                        ? formatScheduleRangeAr(day.scheduledStart, day.scheduledEnd)
                        : '—'}
                    </td>
                    <td>{formatTime12hAr(day.checkIn) ?? '—'}</td>
                    <td>{day.checkOutLabelAr ?? formatTime12hAr(day.checkOut) ?? '—'}</td>
                    <td>{formatDurationAr(day.workedMinutes)}</td>
                    <td><span className="emp-work-print-badge">{day.statusLabelAr}</span></td>
                    <td>{day.lateMinutes > 0 ? formatDurationAr(day.lateMinutes) : '0'}</td>
                    <td className="emp-work-print-revenue-cell">{formatCurrencyAr(day.revenue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    </PageGuard>
  );
}
