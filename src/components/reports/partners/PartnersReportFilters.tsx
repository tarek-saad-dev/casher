'use client';

import { ChevronLeft, ChevronRight, RefreshCw, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ARABIC_MONTHS, REPORT_YEARS } from './partnersReportUtils';

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
  return (
    <div className="print:hidden flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPreviousMonth}
          className="border-zinc-700 bg-zinc-800/50 text-zinc-200 hover:bg-zinc-700"
        >
          <ChevronRight className="h-4 w-4" />
          الشهر السابق
        </Button>

        <Select value={String(month)} onValueChange={(v) => onMonthChange(parseInt(v, 10))}>
          <SelectTrigger className="w-[140px] border-zinc-700 bg-zinc-800/50 text-zinc-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ARABIC_MONTHS.map((name, index) => (
              <SelectItem key={index + 1} value={String(index + 1)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(year)} onValueChange={(v) => onYearChange(parseInt(v, 10))}>
          <SelectTrigger className="w-[100px] border-zinc-700 bg-zinc-800/50 text-zinc-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORT_YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onNextMonth}
          className="border-zinc-700 bg-zinc-800/50 text-zinc-200 hover:bg-zinc-700"
        >
          الشهر التالي
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCurrentMonth}
          disabled={isCurrentMonth}
          className="border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
        >
          الشهر الحالي
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {lastRefresh && (
          <span className="text-xs text-zinc-500">
            آخر تحديث: {lastRefresh.toLocaleTimeString('ar-EG')}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="border-zinc-700 bg-zinc-800/50 text-zinc-200 hover:bg-zinc-700"
        >
          <RefreshCw className={`h-4 w-4 ml-2 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPrint}
          className="border-zinc-700 bg-zinc-800/50 text-zinc-200 hover:bg-zinc-700"
        >
          <Printer className="h-4 w-4 ml-2" />
          طباعة التقرير
        </Button>
      </div>
    </div>
  );
}
