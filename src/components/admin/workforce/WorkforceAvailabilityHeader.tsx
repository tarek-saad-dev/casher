'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { shiftCalendarDate } from '@/lib/businessDate';

export function WorkforceAvailabilityHeader({
  branchName,
  selectedDate,
  todayDate,
  loading,
  lastRefreshAt,
  onDateChange,
  onRefresh,
}: {
  branchName: string;
  selectedDate: string;
  todayDate: string;
  loading: boolean;
  lastRefreshAt: string | null;
  onDateChange: (date: string) => void;
  onRefresh: () => void;
}) {
  return (
    <header className="mb-6 space-y-3" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            إدارة توافر الموظفين
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            الفرع النشط:{' '}
            <span className="text-zinc-200">{branchName || '—'}</span>
            <span className="text-zinc-600"> · التوافر المعروض لهذا الفرع فقط</span>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          aria-label="تحديث"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="اليوم السابق"
          onClick={() => onDateChange(shiftCalendarDate(selectedDate, -1))}
        >
          <ChevronRight className="size-4" />
          السابق
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onDateChange(todayDate)}
        >
          اليوم
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="اليوم التالي"
          onClick={() => onDateChange(shiftCalendarDate(selectedDate, 1))}
        >
          التالي
          <ChevronLeft className="size-4" />
        </Button>
        <Input
          type="date"
          className="w-auto"
          value={selectedDate}
          onChange={(e) => {
            if (e.target.value) onDateChange(e.target.value);
          }}
          aria-label="اختيار تاريخ العمل"
        />
        <span className="text-xs text-zinc-500 font-mono">{selectedDate}</span>
      </div>

      {lastRefreshAt && (
        <p className="text-[11px] text-zinc-500" aria-live="polite">
          آخر تحديث: {lastRefreshAt}
        </p>
      )}
    </header>
  );
}
