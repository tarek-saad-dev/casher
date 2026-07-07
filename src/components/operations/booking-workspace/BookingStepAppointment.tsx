'use client';

import { AlertTriangle, Loader2, Users } from 'lucide-react';
import {
  BORDER,
  GOLD,
  GOLD_BG,
  GOLD_BDR,
  SURFACE,
  type AvailableSlot,
  type BarberAlternative,
  type BookingMode,
  type BookingService,
  type GapNotice,
  fmt,
  formatDateLabel,
  groupSlotsByHour,
  slotDisplayLabel,
} from './types';

interface Props {
  mode: BookingMode;
  bookingDate: string;
  selectedBarberName: string;
  selectedServices: BookingService[];
  totalDuration: number;
  displaySlots: AvailableSlot[];
  availableSlots: AvailableSlot[];
  preferredRangeSlots: AvailableSlot[];
  loadingSlots: boolean;
  slotsAreCurrent: boolean;
  selectedSlot: AvailableSlot | null;
  gapNotice: GapNotice | null;
  slotsDebugReason: string | null;
  nextAvailable: AvailableSlot | null;
  alternativeBarbers: BarberAlternative[];
  hasTimeRange: boolean;
  filterByTimeRange: boolean;
  initialTimeRangeStart?: string;
  initialTimeRangeEnd?: string;
  lockedBarber: boolean;
  onSelectSlot: (slot: AvailableSlot) => void;
  onToggleTimeRangeFilter: () => void;
  onChangeServices: () => void;
  onChangeDate: () => void;
  onSwitchNearest: () => void;
  onSelectAlternativeBarber: (empId: number) => void;
}

export function BookingStepAppointment({
  mode,
  bookingDate,
  selectedBarberName,
  selectedServices,
  totalDuration,
  displaySlots,
  availableSlots,
  preferredRangeSlots,
  loadingSlots,
  slotsAreCurrent,
  selectedSlot,
  gapNotice,
  slotsDebugReason,
  nextAvailable,
  alternativeBarbers,
  hasTimeRange,
  filterByTimeRange,
  initialTimeRangeStart,
  initialTimeRangeEnd,
  lockedBarber,
  onSelectSlot,
  onToggleTimeRangeFilter,
  onChangeServices,
  onChangeDate,
  onSwitchNearest,
  onSelectAlternativeBarber,
}: Props) {
  const slotGroups = groupSlotsByHour(displaySlots);

  const barberLabel = (slot: AvailableSlot) => {
    if (mode === 'nearest') return `مع ${slot.barberName}`;
    return selectedBarberName || slot.barberName;
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl space-y-2" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
        <p className="text-sm font-bold" style={{ color: GOLD }}>
          {mode === 'specific' && selectedBarberName ? selectedBarberName : 'أقرب حلاق متاح'}
          <span className="text-muted-foreground font-normal mx-2">•</span>
          {formatDateLabel(bookingDate)}
        </p>
        <p className="text-sm text-foreground">
          {selectedServices.map((s) => s.ProName).join(' + ')}
        </p>
        <p className="text-base font-bold" style={{ color: GOLD }}>الوقت المطلوب: {totalDuration} دقيقة</p>
      </div>

      {gapNotice && (
        <div className="flex gap-2 p-3 rounded-xl border border-warning/40 bg-warning/10">
          <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning leading-relaxed">{gapNotice.message}</p>
        </div>
      )}

      {loadingSlots && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={18} className="animate-spin" style={{ color: GOLD }} />
            <span>جارٍ حساب المواعيد المتاحة لـ {totalDuration} دقيقة...</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="p-4 min-h-[88px] rounded-xl border animate-pulse" style={{ borderColor: BORDER, background: SURFACE }}>
                <div className="h-4 w-1/2 rounded mb-2" style={{ background: BORDER }} />
                <div className="h-3 w-3/4 rounded" style={{ background: BORDER }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loadingSlots && filterByTimeRange && displaySlots.length === 0 && availableSlots.length > 0 && hasTimeRange && (
        <div className="text-center py-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            لا توجد مواعيد في الفترة المحددة ({fmt(initialTimeRangeStart!)} – {fmt(initialTimeRangeEnd!)})
          </p>
          <button type="button" onClick={onToggleTimeRangeFilter} className="px-4 py-2 min-h-[44px] rounded-lg border text-xs font-semibold" style={{ borderColor: GOLD, color: GOLD }}>
            عرض كل المواعيد المتاحة ({availableSlots.length})
          </button>
        </div>
      )}

      {!loadingSlots && slotsAreCurrent && displaySlots.length === 0 && !(availableSlots.length > 0 && hasTimeRange && filterByTimeRange) && (
        <div className="text-center py-10 space-y-4 rounded-xl border" style={{ borderColor: BORDER, background: SURFACE }}>
          <AlertTriangle size={32} className="mx-auto text-warning" />
          <p className="text-sm font-semibold text-foreground max-w-md mx-auto">
            {slotsDebugReason
              ?? (mode === 'specific' && selectedBarberName
                ? `لا توجد فترة متصلة مدتها ${totalDuration} دقيقة متاحة مع ${selectedBarberName} في هذا اليوم.`
                : 'لا توجد مواعيد متاحة لهذا الاختيار.')}
          </p>
          {nextAvailable && (
            <div className="p-4 rounded-xl border max-w-sm mx-auto" style={{ borderColor: GOLD_BDR, background: GOLD_BG }}>
              <p className="text-xs font-semibold" style={{ color: GOLD }}>أقرب موعد متاح</p>
              <p className="text-sm font-bold mt-1">{nextAvailable.label || slotDisplayLabel(nextAvailable)}</p>
              {mode === 'nearest' && <p className="text-xs text-muted-foreground mt-1">مع {nextAvailable.barberName}</p>}
            </div>
          )}
          {alternativeBarbers.length > 0 && (
            <div className="text-xs space-y-2 max-w-md mx-auto">
              <p className="text-muted-foreground font-semibold">حلاقات بديلة</p>
              {alternativeBarbers.slice(0, 3).map((alt) => (
                <button
                  key={alt.empId}
                  type="button"
                  onClick={() => onSelectAlternativeBarber(alt.empId)}
                  className="w-full p-3 rounded-lg border text-xs text-right min-h-[44px]"
                  style={{ borderColor: BORDER, background: SURFACE }}
                >
                  <span className="font-semibold">{alt.empName}</span> متاح: {fmt(alt.time)} – {fmt(alt.endTime)}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {mode === 'specific' && !lockedBarber && (
              <button type="button" onClick={onSwitchNearest} className="px-4 py-2 min-h-[44px] rounded-lg border text-xs font-semibold" style={{ borderColor: GOLD, color: GOLD }}>أقرب حلاق</button>
            )}
            <button type="button" onClick={onChangeServices} className="px-4 py-2 min-h-[44px] rounded-lg border text-xs" style={{ borderColor: BORDER }}>تغيير الخدمات</button>
            <button type="button" onClick={onChangeDate} className="px-4 py-2 min-h-[44px] rounded-lg border text-xs" style={{ borderColor: BORDER }}>تغيير التاريخ</button>
          </div>
        </div>
      )}

      {!loadingSlots && slotsAreCurrent && displaySlots.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-muted-foreground">
              {displaySlots.length} موعد متاح · كل موعد {totalDuration} دقيقة
            </p>
            {hasTimeRange && (
              <button
                type="button"
                onClick={onToggleTimeRangeFilter}
                className="px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold"
                style={{ borderColor: GOLD_BDR, color: GOLD }}
              >
                {filterByTimeRange
                  ? `عرض كل المواعيد (${availableSlots.length})`
                  : `عرض الفترة المحددة فقط (${preferredRangeSlots.length})`}
              </button>
            )}
          </div>
          <div className="space-y-5">
            {slotGroups.map((group) => (
              <div key={group.label} className="space-y-2">
                <p className="text-sm font-bold text-muted-foreground">{group.label}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.slots.map((slot) => {
                    const isSelected = selectedSlot?.time === slot.time
                      && selectedSlot?.empId === slot.empId
                      && (selectedSlot?.dayOffset ?? 0) === (slot.dayOffset ?? 0);
                    const isFirst = displaySlots[0] === slot;
                    return (
                      <button
                        key={`${slot.empId}-${slot.time}-${slot.dayOffset ?? 0}`}
                        type="button"
                        onClick={() => onSelectSlot(slot)}
                        className="text-right p-4 min-h-[96px] rounded-xl border-2 transition-all"
                        style={{
                          borderColor: isSelected ? GOLD : BORDER,
                          background: isSelected ? GOLD_BG : SURFACE,
                        }}
                      >
                        <p className="text-base font-bold" style={{ color: isSelected ? GOLD : 'var(--foreground)' }}>
                          {slotDisplayLabel(slot)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                          <Users size={12} />
                          {barberLabel(slot)}
                        </p>
                        <p className="text-xs font-semibold mt-1" style={{ color: GOLD }}>
                          {slot.durationMinutes ?? totalDuration} دقيقة
                          {isFirst && mode === 'nearest' && (
                            <span className="mr-2 text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: GOLD_BDR }}>الأقرب</span>
                          )}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedSlot && !loadingSlots && (
        <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--success)', background: 'color-mix(in srgb, var(--success) 5%, transparent)' }}>
          <p className="text-xs text-success font-semibold">✓ تم اختيار الموعد</p>
          <p className="text-sm font-bold mt-1">{slotDisplayLabel(selectedSlot)}</p>
          <p className="text-xs text-muted-foreground mt-1">{barberLabel(selectedSlot)}</p>
        </div>
      )}
    </div>
  );
}
