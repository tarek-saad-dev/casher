'use client';

import { useState, useEffect, useMemo } from 'react';
import { HOUR_CELL_HEIGHT, OPERATION_START_HOUR, OPERATION_END_HOUR } from './schedulerUtils';

interface Props {
  headerHeight?: number;
  selectedDate?: string; // YYYY-MM-DD format
}

const HEADER_HEIGHT = 80;

/**
 * Get current time in Cairo timezone
 * Returns object with hour, minute, date components
 */
function getCairoTimeParts(): {
  hour: number;
  minute: number;
  day: number;
  month: number;
  year: number;
  dateStr: string;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const day = parseInt(get('day'), 10);
  const month = parseInt(get('month'), 10);
  const year = parseInt(get('year'), 10);

  // Format date as YYYY-MM-DD
  const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

  return { hour, minute, day, month, year, dateStr };
}

/**
 * Convert wall-clock time (hour, minute) to operational hour
 * 11:00 = 11, 23:30 = 23.5, 00:30 = 24.5, 04:00 = 28
 */
function toOperationalHour(hour: number, minute: number): number {
  // After midnight (0-4 AM) = next day operational hours
  if (hour >= 0 && hour <= 4) {
    return 24 + hour + minute / 60;
  }
  return hour + minute / 60;
}

/**
 * Format time for display (e.g., "4:25 م")
 */
function formatTimeLabel(hour: number, minute: number): string {
  const period = hour >= 12 ? 'م' : 'ص';
  const displayHour = hour % 12 || 12;
  const displayMinute = minute.toString().padStart(2, '0');
  return `${displayHour}:${displayMinute} ${period}`;
}

export function CurrentTimeLine({ headerHeight = HEADER_HEIGHT, selectedDate }: Props) {
  const [cairoTime, setCairoTime] = useState(getCairoTimeParts);

  // Update time every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCairoTime(getCairoTimeParts());
    }, 30000);

    return () => clearInterval(timer);
  }, []);

  // Calculate position and visibility
  const { top, isVisible, timeLabel } = useMemo(() => {
    const { hour, minute, dateStr } = cairoTime;

    // Only show if selectedDate matches today's date in Cairo
    if (selectedDate && selectedDate !== dateStr) {
      return { top: 0, isVisible: false, timeLabel: '' };
    }

    const operationalHour = toOperationalHour(hour, minute);

    // Check if within operational hours (11 AM to 4 AM next day)
    if (operationalHour < OPERATION_START_HOUR || operationalHour > OPERATION_END_HOUR) {
      return { top: 0, isVisible: false, timeLabel: '' };
    }

    // Calculate top position
    // operational hours start at 11, so subtract 11 to get offset from start
    const hourOffset = operationalHour - OPERATION_START_HOUR;
    const position = headerHeight + hourOffset * HOUR_CELL_HEIGHT;

    return {
      top: position,
      isVisible: true,
      timeLabel: formatTimeLabel(hour, minute),
    };
  }, [cairoTime, headerHeight, selectedDate]);

  if (!isVisible) return null;

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-40"
      style={{
        top,
        height: 0,
      }}
    >
      {/* Main line */}
      <div
        className="absolute left-0 right-0 h-[2px]"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, #22c55e 5%, #22c55e 95%, transparent 100%)',
          boxShadow: '0 0 12px rgba(34, 197, 94, 0.7), 0 0 4px rgba(34, 197, 94, 0.9)',
        }}
      />

      {/* Time label badge */}
      <div
        className="absolute flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap"
        style={{
          right: '12px',
          top: '-14px',
          background: 'rgba(5, 46, 22, 0.95)',
          color: '#22c55e',
          border: '1px solid rgba(34, 197, 94, 0.4)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* Pulse dot */}
        <span
          className="w-2 h-2 rounded-full animate-pulse"
          style={{
            background: '#22c55e',
            boxShadow: '0 0 6px #22c55e',
          }}
        />
        <span>الآن {timeLabel}</span>
      </div>

      {/* Left end cap (near TimeAxis) */}
      <div
        className="absolute left-2 w-2 h-2 rounded-full"
        style={{
          top: '-3px',
          background: '#22c55e',
          boxShadow: '0 0 6px rgba(34, 197, 94, 0.8)',
        }}
      />
    </div>
  );
}
