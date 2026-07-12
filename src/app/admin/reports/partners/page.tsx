'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PartnersReportFilters from '@/components/reports/partners/PartnersReportFilters';
import PartnersEmployeesSection from '@/components/reports/partners/PartnersEmployeesSection';
import PartnersEmployeeFlowSection from '@/components/reports/partners/PartnersEmployeeFlowSection';
import ExpensesByCategorySection from '@/components/reports/partners/ExpensesByCategorySection';
import PartnersOperatingNetFlowSection from '@/components/reports/partners/PartnersOperatingNetFlowSection';
import PartnersFinalSettlementSection from '@/components/reports/partners/PartnersFinalSettlementSection';
import FinancialClassificationPanel from '@/components/reports/FinancialClassificationPanel';
import { ARABIC_MONTHS } from '@/components/reports/partners/partnersReportUtils';
import {
  clampPartnersReportMonth,
  getPartnersReportCurrentMonth,
  isAtPartnersReportMinimum,
} from '@/lib/reports/partnersReportPeriod';
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

function resolvePartnersReportPeriod(
  yearParam: string | null,
  monthParam: string | null,
  now: Date
): { year: number; month: number } {
  const fallback = getPartnersReportCurrentMonth(now);
  const rawYear = parseYearFromParams(yearParam, fallback.year);
  const rawMonth = parseMonthFromParams(monthParam, fallback.month);
  return clampPartnersReportMonth(rawYear, rawMonth);
}

function PartnersReportPageContent() {
  const now = new Date();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const initialPeriod = resolvePartnersReportPeriod(
    searchParams.get('year'),
    searchParams.get('month'),
    now
  );

  const [year, setYear] = useState(initialPeriod.year);
  const [month, setMonth] = useState(initialPeriod.month);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PartnersMonthlyReportResponse | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchIdRef = useRef(0);
  const hasSyncedInitialUrlRef = useRef(false);

  const syncUrl = useCallback((newYear: number, newMonth: number) => {
    router.replace(`${pathname}?year=${newYear}&month=${newMonth}`, { scroll: false });
  }, [pathname, router]);

  const fetchReport = useCallback(async (targetYear: number, targetMonth: number) => {
    const period = clampPartnersReportMonth(targetYear, targetMonth);
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/reports/partners?year=${period.year}&month=${period.month}`
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
      setReport(null);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const applyPeriod = useCallback((newYear: number, newMonth: number) => {
    const period = clampPartnersReportMonth(newYear, newMonth);
    setReport(null);
    setYear(period.year);
    setMonth(period.month);
    syncUrl(period.year, period.month);
    fetchReport(period.year, period.month);
  }, [fetchReport, syncUrl]);

  useEffect(() => {
    document.title = 'تقرير الشركاء | نظام نقاط البيع';
  }, []);

  useEffect(() => {
    const resolved = resolvePartnersReportPeriod(
      searchParams.get('year'),
      searchParams.get('month'),
      now
    );

    const urlYear = parseYearFromParams(searchParams.get('year'), resolved.year);
    const urlMonth = parseMonthFromParams(searchParams.get('month'), resolved.month);
    const urlNeedsCorrection = urlYear !== resolved.year || urlMonth !== resolved.month;

    if (urlNeedsCorrection) {
      syncUrl(resolved.year, resolved.month);
      return;
    }

    if (!hasSyncedInitialUrlRef.current) {
      hasSyncedInitialUrlRef.current = true;
      if (
        searchParams.get('year') == null ||
        searchParams.get('month') == null ||
        urlNeedsCorrection
      ) {
        syncUrl(resolved.year, resolved.month);
      }
    }

    if (resolved.year !== year || resolved.month !== month) {
      setYear(resolved.year);
      setMonth(resolved.month);
    }

    setReport(null);
    fetchReport(resolved.year, resolved.month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const currentPeriod = getPartnersReportCurrentMonth(now);
  const isCurrentMonth = year === currentPeriod.year && month === currentPeriod.month;

  const goToPreviousMonth = () => {
    if (isAtPartnersReportMinimum(year, month)) return;

    if (month === 1) {
      applyPeriod(year - 1, 12);
      return;
    }
    applyPeriod(year, month - 1);
  };

  const goToNextMonth = () => {
    if (month === 12) applyPeriod(year + 1, 1);
    else applyPeriod(year, month + 1);
  };

  const goToCurrentMonth = () => {
    applyPeriod(currentPeriod.year, currentPeriod.month);
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
          .financial-flow .operator {
            display: none !important;
          }
          .financial-flow {
            display: block !important;
          }
          .financial-flow > div {
            margin-bottom: 0.75rem;
          }
        }
      `}</style>

      <div
        className="px-3 py-3 sm:px-5 sm:py-4 lg:px-6 lg:py-6 space-y-3 sm:space-y-4 max-w-[1600px] mx-auto w-full min-w-0 overflow-x-hidden print:p-4 print:max-w-none"
        dir="rtl"
      >
        <div className="hidden print:block mb-4">
          <h1 className="text-xl sm:text-2xl font-bold text-black">تقرير الشركاء</h1>
          <p className="text-sm text-zinc-600">
            ملخص الأداء المالي الشهري — {ARABIC_MONTHS[month - 1]} {year}
          </p>
        </div>

        <header className="print:hidden text-right w-full min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            تقرير الشركاء
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-zinc-400">
            ملخص الأداء المالي الشهري
          </p>
        </header>

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
          <div className="print:hidden flex flex-col items-center gap-4 rounded-xl border border-rose-500/20 bg-rose-950/20 p-4 sm:p-6 w-full min-w-0">
            <div className="flex items-start gap-2 text-rose-400 text-sm text-center max-w-full">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
              <span className="break-words">{error}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => fetchReport(year, month)}
              className="min-h-11 w-full sm:w-auto border-zinc-700"
            >
              إعادة المحاولة
            </Button>
          </div>
        )}

        {(report || loading) && (
          <>
            <FinancialClassificationPanel
              payload={report ?? undefined}
              loading={loading}
              variant="profit"
              legacyNetProfit={report?.classifiedPartnerSplit?.legacyOperatingNet}
              partnerSplitExplanation={report?.classifiedPartnerSplit?.explanation}
            />

            <PartnersEmployeesSection
              rows={report?.employeeSummary ?? []}
              totals={
                report?.employeeSummaryTotals ?? {
                  totalShopRevenue: 0,
                  totalPaidSalaryAndAdvances: 0,
                }
              }
              loading={loading}
            />

            <PartnersEmployeeFlowSection
              totals={
                report?.employeeSummaryTotals ?? {
                  totalShopRevenue: 0,
                  totalPaidSalaryAndAdvances: 0,
                }
              }
              loading={loading}
            />

            <ExpensesByCategorySection
              year={year}
              month={month}
              rows={report?.expensesByCategory ?? []}
              totalOperatingExpenses={report?.summary.operatingExpenses ?? 0}
              loading={loading}
              error={error}
              onRetry={() => fetchReport(year, month)}
            />

            <PartnersOperatingNetFlowSection
              totals={
                report?.employeeSummaryTotals ?? {
                  totalShopRevenue: 0,
                  totalPaidSalaryAndAdvances: 0,
                }
              }
              filteredOperatingExpenses={report?.summary.operatingExpenses ?? 0}
              loading={loading}
            />

            <PartnersFinalSettlementSection
              year={year}
              month={month}
              totals={
                report?.employeeSummaryTotals ?? {
                  totalShopRevenue: 0,
                  totalPaidSalaryAndAdvances: 0,
                }
              }
              filteredOperatingExpenses={report?.summary.operatingExpenses ?? 0}
              loading={loading}
              classifiedOperatingNet={report?.classifiedPartnerSplit?.cleanNetProfit}
              legacyOperatingNet={report?.classifiedPartnerSplit?.legacyOperatingNet}
            />
          </>
        )}
      </div>
    </>
  );
}

export default function PartnersReportPage() {
  return (
    <Suspense fallback={
      <div className="px-3 py-6 text-sm sm:text-base text-zinc-400 text-center w-full min-w-0" dir="rtl">
        جاري تحميل التقرير...
      </div>
    }>
      <PartnersReportPageContent />
    </Suspense>
  );
}
