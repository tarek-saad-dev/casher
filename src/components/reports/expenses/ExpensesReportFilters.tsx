'use client';

import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface ExpensesReportFiltersProps {
  month: number;
  year: number;
  onMonthChange: (month: number) => void;
  onYearChange: (year: number) => void;
  onUpdate: () => void;
  loading: boolean;
}

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

export default function ExpensesReportFilters({
  month,
  year,
  onMonthChange,
  onYearChange,
  onUpdate,
  loading,
}: ExpensesReportFiltersProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 2019 }, (_, i) => 2020 + i);

  return (
    <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-lg">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">الشهر:</label>
        <select
          value={month}
          onChange={(e) => onMonthChange(parseInt(e.target.value))}
          className="px-3 py-2 border border-border rounded-md bg-background text-sm"
          disabled={loading}
        >
          {ARABIC_MONTHS.map((monthName, index) => (
            <option key={index + 1} value={index + 1}>
              {monthName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">السنة:</label>
        <select
          value={year}
          onChange={(e) => onYearChange(parseInt(e.target.value))}
          className="px-3 py-2 border border-border rounded-md bg-background text-sm"
          disabled={loading}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <Button
        onClick={onUpdate}
        disabled={loading}
        size="sm"
        className="gap-2"
      >
        {loading ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        تحديث
      </Button>
    </div>
  );
}
