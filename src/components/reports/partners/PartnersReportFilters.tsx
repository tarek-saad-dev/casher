'use client';

import { ChevronLeft, ChevronRight, RefreshCw, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ARABIC_MONTHS } from './partnersReportUtils';
import {
  getPartnersReportAllowedMonths,
  getPartnersReportAllowedYears,
  isAtPartnersReportMinimum,
  PARTNERS_REPORT_PREVIOUS_MONTH_DISABLED_TITLE,
} from '@/lib/reports/partnersReportPeriod';

interface PartnersReportFiltersProps {
  year: number;
  month: number;
  loading: boolean;
  lastRefresh: Date | null;
  isCurrentMonth: boolean;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onCurrentMonth: () => void;
  onRefresh: () => void;
  onPrint: () => void;
}

const touchButtonClass =
  'min-h-11 border-zinc-700 bg-zinc-800/50 text-zinc-200 hover:bg-zinc-700 focus-visible:ring-2 focus-visible:ring-amber-500/50';

export default function PartnersReportFilters({
  year,
  month,
  loading,
  lastRefresh,
  isCurrentMonth,
  onYearChange,
  onMonthChange,
  onPreviousMonth,
  onNextMonth,
  onCurrentMonth,
  onRefresh,
  onPrint,
}: PartnersReportFiltersProps) {
  const allowedYears = getPartnersReportAllowedYears();
  const allowedMonths = getPartnersReportAllowedMonths(year);
  const isPreviousMonthDisabled = isAtPartnersReportMinimum(year, month);

  return (
    <div className="print:hidden w-full min-w-0 bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3 sm:p-4 space-y-3">
      {/* Row 1: month + year */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <Select value={String(month)} onValueChange={(v) => onMonthChange(parseInt(v, 10))}>
          <SelectTrigger
            aria-label="اختيار الشهر"
            className="w-full min-h-11 h-11 border-zinc-700 bg-zinc-800/50 text-zinc-200 text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowedMonths.map((monthValue) => (
              <SelectItem key={monthValue} value={String(monthValue)}>
                {ARABIC_MONTHS[monthValue - 1]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(year)} onValueChange={(v) => onYearChange(parseInt(v, 10))}>
          <SelectTrigger
            aria-label="اختيار السنة"
            className="w-full min-h-11 h-11 border-zinc-700 bg-zinc-800/50 text-zinc-200 text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowedYears.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Row 2: navigation */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onPreviousMonth}
          disabled={isPreviousMonthDisabled}
          title={
            isPreviousMonthDisabled
              ? PARTNERS_REPORT_PREVIOUS_MONTH_DISABLED_TITLE
              : undefined
          }
          aria-label="الشهر السابق"
          className={`${touchButtonClass} px-2 text-xs sm:text-sm disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed`}
        >
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate sm:hidden">السابق</span>
          <span className="truncate hidden sm:inline">الشهر السابق</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onCurrentMonth}
          disabled={isCurrentMonth}
          aria-label="الشهر الحالي"
          className="min-h-11 border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 text-xs sm:text-sm px-2 focus-visible:ring-2 focus-visible:ring-amber-500/50"
        >
          <span className="truncate sm:hidden">الحالي</span>
          <span className="truncate hidden sm:inline">الشهر الحالي</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onNextMonth}
          aria-label="الشهر التالي"
          className={`${touchButtonClass} px-2 text-xs sm:text-sm`}
        >
          <span className="truncate sm:hidden">التالي</span>
          <span className="truncate hidden sm:inline">الشهر التالي</span>
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
        </Button>
      </div>

      {/* Row 3: refresh + print */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {lastRefresh && (
          <span className="text-xs text-zinc-500 text-center sm:text-right">
            آخر تحديث: {lastRefresh.toLocaleTimeString('ar-EG')}
          </span>
        )}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2 sm:ms-auto">
          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            disabled={loading}
            aria-label="تحديث التقرير"
            className={`${touchButtonClass} w-full sm:w-auto text-sm`}
          >
            <RefreshCw className={`h-4 w-4 shrink-0 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            تحديث
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onPrint}
            aria-label="طباعة التقرير"
            className={`${touchButtonClass} w-full sm:w-auto text-sm`}
          >
            <Printer className="h-4 w-4 shrink-0" aria-hidden />
            <span className="sm:hidden">طباعة</span>
            <span className="hidden sm:inline">طباعة التقرير</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
