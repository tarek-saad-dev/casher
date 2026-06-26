'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import PartnersReportFilters from '@/components/reports/partners/PartnersReportFilters';
import PartnersSummaryCards from '@/components/reports/partners/PartnersSummaryCards';
import RevenueDetailsSection from '@/components/reports/partners/RevenueDetailsSection';
import ExpensesByCategorySection from '@/components/reports/partners/ExpensesByCategorySection';
import PartnersEmployeeAdvancesSection from '@/components/reports/partners/PartnersEmployeeAdvancesSection';
import FinancialEquationSection from '@/components/reports/partners/FinancialEquationSection';
import { ARABIC_MONTHS } from '@/components/reports/partners/partnersReportUtils';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';

function parseYearFromParams(value: string | null, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseMonthFromParams(value: string | null, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) return fallback;
  return parsed;
}

function PartnersReportPageContent() {
  const now = new Date();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [year, setYear] = useState(() =>
    parseYearFromParams(searchParams.get('year'), now.getFullYear())
  );
  const [month, setMonth] = useState(() =>
    parseMonthFromParams(searchParams.get('month'), now.getMonth() + 1)
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PartnersMonthlyReportResponse | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchIdRef = useRef(0);

  const syncUrl = useCallback((newYear: number, newMonth: number) => {
    router.replace(`${pathname}?year=${newYear}&month=${newMonth}`, { scroll: false });
  }, [pathname, router]);

  const fetchReport = useCallback(async (targetYear: number, targetMonth: number) => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/reports/partners?year=${targetYear}&month=${targetMonth}`
      );

      if (fetchId !== fetchIdRef.current) return;

      if (response.status === 401) {
        throw new Error('غير مصرح — يرجى تسجيل الدخول');
      }
      if (response.status === 403) {
        throw new Error('غير مصرح — لا تملك صلاحية عرض هذا التقرير');
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'فشل تحميل التقرير');
      }

      const data: PartnersMonthlyReportResponse = await response.json();
      if (fetchId !== fetchIdRef.current) return;

      setReport(data);
      setLastRefresh(new Date());
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setError(message);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const applyPeriod = useCallback((newYear: number, newMonth: number) => {
    setYear(newYear);
    setMonth(newMonth);
    syncUrl(newYear, newMonth);
    fetchReport(newYear, newMonth);
  }, [fetchReport, syncUrl]);

  useEffect(() => {
    document.title = 'تقرير الشركاء | نظام نقاط البيع';
  }, []);

  useEffect(() => {
    const urlYear = parseYearFromParams(searchParams.get('year'), year);
    const urlMonth = parseMonthFromParams(searchParams.get('month'), month);
    if (urlYear !== year || urlMonth !== month) {
      setYear(urlYear);
      setMonth(urlMonth);
    }
    fetchReport(urlYear, urlMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const goToPreviousMonth = () => {
    if (month === 1) applyPeriod(year - 1, 12);
    else applyPeriod(year, month - 1);
  };

  const goToNextMonth = () => {
    if (month === 12) applyPeriod(year + 1, 1);
    else applyPeriod(year, month + 1);
  };

  const goToCurrentMonth = () => {
    applyPeriod(now.getFullYear(), now.getMonth() + 1);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          nav, header, aside, footer {
            display: none !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
        }
      `}</style>

      <div className="p-6 space-y-6 max-w-[1600px] mx-auto print:p-4 print:max-w-none" dir="rtl">
        <div className="hidden print:block mb-6">
          <h1 className="text-2xl font-bold text-black">تقرير الشركاء</h1>
          <p className="text-sm text-zinc-600">
            ملخص الأداء المالي الشهري — {ARABIC_MONTHS[month - 1]} {year}
          </p>
        </div>

        <div className="print:hidden">
          <PageHeader
            title="تقرير الشركاء"
            description="ملخص الأداء المالي الشهري"
          />
        </div>

        <PartnersReportFilters
          year={year}
          month={month}
          loading={loading}
          lastRefresh={lastRefresh}
          isCurrentMonth={isCurrentMonth}
          onYearChange={(y) => applyPeriod(y, month)}
          onMonthChange={(m) => applyPeriod(year, m)}
          onPreviousMonth={goToPreviousMonth}
          onNextMonth={goToNextMonth}
          onCurrentMonth={goToCurrentMonth}
          onRefresh={() => fetchReport(year, month)}
          onPrint={handlePrint}
        />

        {error && !report && (
          <div className="print:hidden flex flex-col items-center gap-4 rounded-xl border border-rose-500/20 bg-rose-950/20 p-8">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => fetchReport(year, month)}
              className="border-zinc-700"
            >
              إعادة المحاولة
            </Button>
          </div>
        )}

        {(report || loading) && (
          <>
            <PartnersSummaryCards
              summary={report?.summary ?? null}
              loading={loading}
            />

            <RevenueDetailsSection
              rows={report?.revenueDetails ?? []}
              totalRevenue={report?.summary.totalRevenue ?? 0}
              loading={loading}
            />

            <ExpensesByCategorySection
              rows={report?.expensesByCategory ?? []}
              totalExpenses={report?.summary.totalExpenses ?? 0}
              loading={loading}
              error={error}
              onRetry={() => fetchReport(year, month)}
            />

            <PartnersEmployeeAdvancesSection
              rows={report?.employeeAdvances ?? []}
              totalAdvances={report?.summary.totalEmployeeAdvances ?? 0}
              loading={loading}
            />

            {report?.summary && (
              <FinancialEquationSection summary={report.summary} />
            )}
          </>
        )}
      </div>
    </>
  );
}

export default function PartnersReportPage() {
  return (
    <Suspense fallback={
      <div className="p-6 text-zinc-400" dir="rtl">جاري تحميل التقرير...</div>
    }>
      <PartnersReportPageContent />
    </Suspense>
  );
}
