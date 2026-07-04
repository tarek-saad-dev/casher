'use client';

import { generateOperationalHours, formatOperationalHour, HOUR_CELL_HEIGHT } from './schedulerUtils';
import { OPS_LAYOUT } from './operationsLayout.constants';
import { cn } from '@/lib/utils';

interface Props {
  headerHeight?: number;
  className?: string;
}

export function TimeAxis({ headerHeight = OPS_LAYOUT.HEADER_HEIGHT, className }: Props) {
  const hours = generateOperationalHours();

  return (
    <div
      className={cn(
        'sticky start-0 z-30 flex shrink-0 flex-col border-border/80 bg-card/95 backdrop-blur-sm',
        className,
      )}
      style={{
        width: OPS_LAYOUT.TIME_AXIS_WIDTH,
        borderInlineStartWidth: 1,
      }}
    >
      <div
        className="sticky top-0 z-10 border-b border-border/80 bg-card/95"
        style={{ height: headerHeight }}
      />

      {hours.map((hour) => {
        const isNextDay = hour >= 24;
        const isMajorHour = hour % 1 === 0;

        return (
          <div
            key={hour}
            className="relative border-b border-border/40"
            style={{ height: HOUR_CELL_HEIGHT }}
          >
            {/* 30-minute guide */}
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/25"
              aria-hidden
            />

            <div
              className={cn(
                'flex items-start justify-center px-1 pt-2 text-center',
                isMajorHour ? 'text-xs font-bold text-foreground' : 'text-[11px] text-muted-foreground',
              )}
            >
              <span className={isNextDay ? 'text-primary' : undefined}>
                {formatOperationalHour(hour)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
