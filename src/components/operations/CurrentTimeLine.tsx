'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  OPERATION_START_HOUR,
  OPERATION_END_HOUR,
  getCairoBusinessDate,
  getCairoTimeParts,
  operationalHourToScrollY,
  wallClockToOperationalHour,
} from './schedulerUtils';
import { OPS_LAYOUT } from './operationsLayout.constants';

interface Props {
  headerHeight?: number;
  selectedDate?: string;
}

function formatTimeLabel(hour: number, minute: number): string {
  const period = hour >= 12 ? 'م' : 'ص';
  const displayHour = hour % 12 || 12;
  const displayMinute = minute.toString().padStart(2, '0');
  return `${displayHour}:${displayMinute} ${period}`;
}

export function CurrentTimeLine({ headerHeight = OPS_LAYOUT.HEADER_HEIGHT, selectedDate }: Props) {
  const [cairoTime, setCairoTime] = useState(getCairoTimeParts);

  useEffect(() => {
    const timer = setInterval(() => {
      setCairoTime(getCairoTimeParts());
    }, 60_000);

    return () => clearInterval(timer);
  }, []);

  const { top, isVisible, timeLabel } = useMemo(() => {
    const { hour, minute } = cairoTime;

    if (selectedDate && selectedDate !== getCairoBusinessDate()) {
      return { top: 0, isVisible: false, timeLabel: '' };
    }

    const operationalHour = wallClockToOperationalHour(hour, minute);

    if (operationalHour < OPERATION_START_HOUR || operationalHour > OPERATION_END_HOUR) {
      return { top: 0, isVisible: false, timeLabel: '' };
    }

    return {
      top: operationalHourToScrollY(operationalHour, headerHeight),
      isVisible: true,
      timeLabel: formatTimeLabel(hour, minute),
    };
  }, [cairoTime, headerHeight, selectedDate]);

  if (!isVisible) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-30"
      style={{ top, height: 0 }}
    >
      <div className="absolute inset-x-0 h-px bg-success/80 shadow-[0_0_6px_color-mix(in_srgb,var(--success)_35%,transparent)]" />

      <div className="absolute end-3 top-0 flex -translate-y-1/2 items-center gap-1 rounded-full border border-success/35 bg-card/95 px-2 py-0.5 text-[11px] font-semibold text-success shadow-sm backdrop-blur-sm">
        <span className="size-1.5 rounded-full bg-success" aria-hidden />
        <span>الآن {timeLabel}</span>
      </div>

      <div className="absolute start-3 top-0 size-1.5 -translate-y-1/2 rounded-full bg-success" aria-hidden />
    </div>
  );
}

/** Exported for visibility checks without duplicating math */
export function getCurrentTimelineY(headerHeight: number, selectedDate?: string): number | null {
  if (selectedDate && selectedDate !== getCairoBusinessDate()) return null;
  const { hour, minute } = getCairoTimeParts();
  const operationalHour = wallClockToOperationalHour(hour, minute);
  if (operationalHour < OPERATION_START_HOUR || operationalHour > OPERATION_END_HOUR) return null;
  return operationalHourToScrollY(operationalHour, headerHeight);
}
