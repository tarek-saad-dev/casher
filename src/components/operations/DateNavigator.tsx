'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Props {
  date: string;
  dateLabel: string;
  loading?: boolean;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  onDateSelect?: (date: string) => void;
  onRefresh: () => void;
  className?: string;
  compact?: boolean;
}

const segmentBtn =
  'inline-flex h-10 min-h-[42px] shrink-0 items-center justify-center border-0 bg-transparent px-2.5 text-sm font-medium transition-colors duration-150 hover:bg-surface-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 min-[768px]:h-[42px] md:px-3';

const segmentIconBtn =
  'inline-flex size-10 min-h-[42px] min-w-[42px] shrink-0 items-center justify-center border-0 bg-transparent transition-colors duration-150 hover:bg-surface-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset min-[768px]:size-[42px]';

export function DateNavigator({
  date,
  dateLabel,
  loading,
  onPrevDay,
  onNextDay,
  onToday,
  onDateSelect,
  onRefresh,
  className,
  compact = false,
}: Props) {
  const [showCalendar, setShowCalendar] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setShowCalendar(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDateSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedDate = e.target.value;
    if (selectedDate && onDateSelect) {
      onDateSelect(selectedDate);
    }
    setShowCalendar(false);
  };

  return (
    <div
      className={cn(
        'flex w-full shrink-0 items-center gap-2 md:w-auto',
        compact && 'md:w-auto',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-border/80 bg-surface-muted/30 md:flex-none',
          compact && 'flex-1 md:flex-none',
        )}
        role="group"
        aria-label="التنقل بين التواريخ"
      >
        <button
          type="button"
          onClick={onToday}
          className={cn(segmentBtn, 'border-s border-border/60 font-semibold text-foreground')}
        >
          اليوم
        </button>

        <button
          type="button"
          onClick={onPrevDay}
          className={cn(segmentIconBtn, 'border-s border-border/60')}
          aria-label="اليوم السابق"
          title="اليوم السابق"
        >
          <ChevronRight className="size-4 text-primary" />
        </button>

        <div className="relative min-w-0 flex-1 border-s border-border/60" ref={calendarRef}>
          <button
            type="button"
            onClick={() => setShowCalendar(!showCalendar)}
            className={cn(
              segmentBtn,
              'h-10 w-full min-w-0 gap-2 px-3 font-semibold text-foreground min-[768px]:h-[42px] md:min-w-[180px]',
            )}
            title="اختر تاريخ"
            aria-label="اختر تاريخ"
          >
            <Calendar className="size-4 shrink-0 text-primary" />
            <span className="truncate whitespace-nowrap">{dateLabel}</span>
          </button>

          {showCalendar && (
            <div
              className="absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 rounded-xl border border-border bg-popover p-3 shadow-2xl"
              role="dialog"
              aria-label="اختيار التاريخ"
            >
              <input
                type="date"
                value={date}
                onChange={handleDateSelect}
                className="rounded-lg border border-input bg-background px-3 py-2 text-center text-sm text-foreground"
                style={{ colorScheme: 'dark' }}
                autoFocus
              />
              <div className="mt-2 text-center">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onToday();
                    setShowCalendar(false);
                  }}
                >
                  الذهاب لليوم
                </Button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onNextDay}
          className={cn(segmentIconBtn, 'border-s border-border/60')}
          aria-label="اليوم التالي"
          title="اليوم التالي"
        >
          <ChevronLeft className="size-4 text-primary" />
        </button>
      </div>

      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onRefresh}
        disabled={loading}
        className="size-10 min-h-[42px] min-w-[42px] shrink-0 rounded-xl border-border/80 bg-surface-muted/40 transition-all duration-150 hover:bg-surface-muted/70 focus-visible:ring-2 min-[768px]:size-[42px]"
        aria-label="تحديث لوحة التشغيل"
        title="تحديث"
      >
        <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
      </Button>
    </div>
  );
}
