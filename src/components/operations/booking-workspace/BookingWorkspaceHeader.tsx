'use client';

import { X, Calendar, RotateCcw } from 'lucide-react';
import {
  BOOKING_STEPS,
  BORDER,
  GOLD,
  GOLD_BDR,
  type BookingMode,
  type BookingStep,
  formatDateLabel,
} from './types';

interface Props {
  step: BookingStep;
  bookingDate: string;
  mode: BookingMode;
  totalDuration: number;
  selectedServicesCount: number;
  showDatePicker: boolean;
  onToggleDatePicker: () => void;
  onDateChange: (date: string) => void;
  onClose: () => void;
  onReset?: () => void;
  getCairoToday: () => string;
  getCairoTomorrow: () => string;
}

export function BookingWorkspaceHeader({
  step,
  bookingDate,
  mode,
  totalDuration,
  selectedServicesCount,
  showDatePicker,
  onToggleDatePicker,
  onDateChange,
  onClose,
  onReset,
  getCairoToday,
  getCairoTomorrow,
}: Props) {
  const subtitle =
    step === 1 ? 'اختر الحلاق والخدمات والموعد'
      : step < 5 ? 'أكمل بيانات الحجز'
        : 'راجع الحجز قبل التأكيد';

  return (
    <header className="shrink-0 border-b px-4 py-3 sm:px-5 sm:py-4" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="booking-workspace-title" className="text-base sm:text-lg font-bold text-foreground">
            إنشاء حجز جديد
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border" style={{ borderColor: GOLD_BDR, color: GOLD }}>
              <Calendar className="w-3 h-3" />
              {formatDateLabel(bookingDate)}
            </span>
            <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold border" style={{ borderColor: BORDER }}>
              {mode === 'nearest' ? 'أقرب حلاق' : 'حلاق معين'}
            </span>
            {selectedServicesCount > 0 && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: GOLD }}>
                {totalDuration} دقيقة
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onReset && step > 1 && (
            <button
              type="button"
              onClick={onReset}
              className="p-2 min-h-[44px] min-w-[44px] rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors"
              aria-label="إعادة تعيين"
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={onToggleDatePicker}
            className="hidden sm:flex px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold items-center gap-1.5"
            style={{ borderColor: GOLD_BDR, color: GOLD }}
          >
            <Calendar size={14} />
            تغيير التاريخ
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-h-[44px] min-w-[44px] rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors"
            aria-label="إغلاق"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      {showDatePicker && (
        <div className="flex flex-wrap gap-2 items-center mt-3 pt-3 border-t" style={{ borderColor: BORDER }}>
          <button type="button" onClick={() => onDateChange(getCairoToday())} className="px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold" style={{ borderColor: GOLD_BDR, color: GOLD }}>اليوم</button>
          <button type="button" onClick={() => onDateChange(getCairoTomorrow())} className="px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold" style={{ borderColor: BORDER }}>غدًا</button>
          <input
            type="date"
            value={bookingDate}
            min={getCairoToday()}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
            className="flex-1 min-h-[44px] rounded-lg border px-2 text-xs bg-transparent min-w-[140px]"
            style={{ borderColor: BORDER, colorScheme: 'dark' }}
            aria-label="اختيار التاريخ"
          />
        </div>
      )}
      <div className="xl:hidden flex gap-1 mt-3 overflow-x-auto pb-1">
        {BOOKING_STEPS.map((s) => (
          <span
            key={s.id}
            className="shrink-0 px-2 py-1 rounded-md text-[10px] font-semibold"
            style={{
              background: step === s.id ? 'color-mix(in srgb, var(--primary) 15%, transparent)' : 'var(--surface-muted)',
              color: step >= s.id ? GOLD : 'var(--muted-foreground)',
            }}
          >
            {s.id}. {s.label}
          </span>
        ))}
      </div>
    </header>
  );
}
