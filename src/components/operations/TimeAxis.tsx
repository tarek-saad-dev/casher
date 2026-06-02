'use client';

import { generateOperationalHours, formatOperationalHour, HOUR_CELL_HEIGHT } from './schedulerUtils';

interface Props {
  headerHeight?: number;
}

export function TimeAxis({ headerHeight = 80 }: Props) {
  const hours = generateOperationalHours();

  return (
    <div
      className="flex flex-col shrink-0 sticky left-0 z-20 bg-[#0a0a0a]"
      style={{
        width: '64px',
        borderLeft: '1px solid rgba(212, 175, 55, 0.2)',
        borderRight: '1px solid rgba(212, 175, 55, 0.1)',
      }}
    >
      {/* Header spacer - Sticky */}
      <div className="sticky top-0 z-10 bg-[#0a0a0a]" style={{ height: headerHeight, borderBottom: '1px solid rgba(212, 175, 55, 0.2)' }} />

      {/* Hour labels */}
      {hours.map((hour) => (
        <div
          key={hour}
          className="flex items-start justify-center text-xs font-medium border-b border-[rgba(212,175,55,0.1)]"
          style={{
            height: HOUR_CELL_HEIGHT,
            color: hour >= 24 ? '#d4af37' : '#a1a1aa', // Gold for next day hours
            paddingTop: '8px',
          }}
        >
          {formatOperationalHour(hour)}
        </div>
      ))}
    </div>
  );
}
