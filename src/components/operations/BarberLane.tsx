'use client';

import { useState } from 'react';
import { User, Clock, Users } from 'lucide-react';
import { HourCellCard } from './HourCellCard';
import { MoreTimelineItemsModal } from './MoreTimelineItemsModal';
import {
  generateOperationalHours,
  groupItemsByHour,
  HOUR_CELL_HEIGHT,
  TimelineItem,
  getFreeSegmentsInCell,
  FreeSegment,
  operationalHourToTime,
  formatShortTime,
  formatOperationalHour,
} from './schedulerUtils';

interface Barber {
  empId: number;
  empName: string;
  status: 'working' | 'off' | 'day_off' | 'absent' | 'not_checked_in' | 'unknown';
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  nextAvailableAt: string | null;
  waitingCount: number;
  bookingsCount: number;
  inServiceCount: number;
  timeline: TimelineItem[];
}

interface BarberColor {
  bg: string;
  border: string;
  text: string;
  dot: string;
  label: string;
}

interface Props {
  barber: Barber;
  headerHeight?: number;
  onItemClick?: (item: TimelineItem) => void;
  voiceEnabled?: boolean;
  onReannounce?: (ticketId: number) => Promise<boolean>;
  onEmptyCellClick?: (hour: number, barber: Barber) => void;
  onFreeSegmentClick?: (segment: FreeSegment, barber: Barber, hour: number) => void;
  currentDate?: string;
  color?: BarberColor;
}

export function BarberLane({ barber, headerHeight = 80, onItemClick, voiceEnabled, onReannounce, onEmptyCellClick, onFreeSegmentClick, currentDate, color }: Props) {
  const barberColor = color || { bg: 'rgba(212, 175, 55, 0.12)', border: 'rgba(212, 175, 55, 0.55)', text: '#d4af37', dot: '#d4af37', label: 'gold' };
  const hours = generateOperationalHours();
  const itemsByHour = groupItemsByHour(barber.timeline);

  // State for more items modal
  const [moreItemsModalOpen, setMoreItemsModalOpen] = useState(false);
  const [selectedCellItems, setSelectedCellItems] = useState<TimelineItem[]>([]);
  const [selectedHourLabel, setSelectedHourLabel] = useState<string>('');

  const getStatusColor = () => {
    if (barber.status === 'day_off') return '#ef4444';
    if (barber.status === 'off') return '#f59e0b';
    return '#22c55e';
  };

  const getStatusLabel = () => {
    if (barber.status === 'day_off') return 'إجازة';
    if (barber.status === 'off') return 'خارج ساعات العمل';
    return 'نشط';
  };

  return (
    <div
      className="flex flex-col shrink-0"
      style={{
        minWidth: '260px',
        maxWidth: '280px',
        borderRight: '1px solid rgba(212, 175, 55, 0.1)',
      }}
    >
      {/* Header - Sticky */}
      <div
        className="p-3 border-b sticky top-0 z-10"
        style={{
          height: headerHeight,
          background: barberColor.bg,
          borderColor: barberColor.border,
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: barberColor.bg, border: `1px solid ${barberColor.border}` }}
          >
            <User className="w-4 h-4" style={{ color: barberColor.dot }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-white text-sm truncate">{barber.empName}</h3>
            <div className="flex items-center gap-1 text-xs">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: getStatusColor() }}
              />
              <span className="truncate" style={{ color: barberColor.text }}>{getStatusLabel()}</span>
            </div>
          </div>
        </div>

        {/* Compact Stats */}
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {barber.waitingCount > 0 && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.05)]">
              <Users className="w-3 h-3" style={{ color: '#a1a1aa' }} />
              <span style={{ color: '#a1a1aa' }}>{barber.waitingCount}</span>
            </div>
          )}
          {barber.inServiceCount > 0 && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[rgba(212,175,55,0.15)]">
              <Clock className="w-3 h-3" style={{ color: '#d4af37' }} />
              <span style={{ color: '#d4af37' }}>{barber.inServiceCount} خدمة</span>
            </div>
          )}
          {barber.nextAvailableAt && barber.waitingCount === 0 && barber.inServiceCount === 0 && (
            <div className="flex items-center gap-1" style={{ color: '#22c55e' }}>
              <span>متاح</span>
            </div>
          )}
        </div>
      </div>

      {/* Hour Cells */}
      <div className="flex-1">
        {hours.map((hour) => {
          const items = itemsByHour.get(hour) || [];
          const visibleItems = items.slice(0, 2);
          const moreCount = items.length - 2;

          // Determine if this hour is within working hours
          const isWorkingHour = barber.workStart && barber.workEnd && isHourInRange(
            hour,
            barber.workStart,
            barber.workEnd,
            barber.isOvernightShift
          );

          // Calculate free segments when there are items in the cell
          let freeSegments: FreeSegment[] = [];
          if (items.length > 0 && currentDate) {
            const cellStart = operationalHourToTime(hour, currentDate);
            const cellEnd = operationalHourToTime(hour + 1, currentDate);
            freeSegments = getFreeSegmentsInCell(cellStart, cellEnd, items);
          }

          return (
            <div
              key={hour}
              className="border-b border-[rgba(212,175,55,0.08)]"
              style={{
                height: HOUR_CELL_HEIGHT,
                background: isWorkingHour ? 'transparent' : 'rgba(0,0,0,0.3)',
              }}
            >
              {items.length === 0 ? (
                // Empty cell - clickable for creating booking
                <button
                  onClick={() => onEmptyCellClick?.(hour, barber)}
                  className="h-full w-full flex items-center justify-center transition-all hover:bg-white/[0.02] group cursor-pointer"
                  style={{
                    background: isWorkingHour ? 'transparent' : 'rgba(0,0,0,0.3)',
                  }}
                >
                  <span 
                    className="text-[10px] opacity-0 group-hover:opacity-100 transition-all px-2 py-1 rounded border border-dashed border-yellow-500/30 bg-yellow-500/5 text-yellow-300/70 hover:bg-yellow-500/10 hover:text-yellow-300"
                  >
                    + حجز
                  </span>
                </button>
              ) : (
                // Cell with items - show items and free segment booking buttons
                <div className="h-full p-1.5 flex flex-col gap-1">
                  {visibleItems.map((item, idx) => (
                    <HourCellCard
                      key={idx}
                      item={item}
                      compact={items.length > 1}
                      onClick={onItemClick}
                      voiceEnabled={voiceEnabled}
                      onReannounce={onReannounce}
                      barberColor={barberColor}
                    />
                  ))}

                  {moreCount > 0 && (
                    <button
                      className="text-[10px] px-2 py-0.5 rounded bg-[rgba(212,175,55,0.15)] hover:bg-[rgba(212,175,55,0.25)] transition-colors self-center"
                      style={{ color: '#d4af37' }}
                      onClick={() => {
                        setSelectedCellItems(items);
                        setSelectedHourLabel(formatOperationalHour(hour));
                        setMoreItemsModalOpen(true);
                      }}
                    >
                      +{moreCount} المزيد
                    </button>
                  )}

                  {/* Free segment booking buttons */}
                  {freeSegments.length > 0 && freeSegments.map((segment, idx) => (
                    <button
                      key={idx}
                      onClick={() => onFreeSegmentClick?.(segment, barber, hour)}
                      className="flex items-center justify-center gap-1 px-2 py-0.5 rounded border border-dashed border-yellow-500/30 bg-yellow-500/5 text-yellow-300/70 text-[10px] transition-all hover:bg-yellow-500/10 hover:text-yellow-300"
                      title={`حجز من ${formatShortTime(segment.start)} إلى ${formatShortTime(segment.end)}`}
                    >
                      <span>+ حجز</span>
                      <span className="text-[9px] opacity-60">{formatShortTime(segment.start)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* More Items Modal for this barber */}
      <MoreTimelineItemsModal
        open={moreItemsModalOpen}
        onClose={() => setMoreItemsModalOpen(false)}
        items={selectedCellItems}
        barberName={barber.empName}
        hourLabel={selectedHourLabel}
        onOpenDetails={onItemClick}
      />
    </div>
  );
}

function isHourInRange(hour: number, workStart: string, workEnd: string, isOvernight: boolean): boolean {
  const startHour = parseInt(workStart.split(':')[0]);
  let endHour = parseInt(workEnd.split(':')[0]);

  if (isOvernight && endHour <= 4) {
    endHour += 24;
  }

  if (isOvernight) {
    return hour >= startHour || hour <= endHour;
  }

  return hour >= startHour && hour <= endHour;
}
