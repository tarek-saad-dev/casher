'use client';

import { useRef, useState } from 'react';
import { User, Clock, Users } from 'lucide-react';
import { HourCellCard } from './HourCellCard';
import { MoreTimelineItemsModal } from './MoreTimelineItemsModal';
import { BookingDragPreview } from './BookingDragPreview';
import { BookingPasteTargets } from './BookingPasteTargets';
import type { PasteCandidateSlot, BookingMoveSession } from '@/lib/bookingDragReschedule';
import {
  generateOperationalHours,
  HOUR_CELL_HEIGHT,
  TimelineItem,
  getFreeSegmentsInCell,
  FreeSegment,
  operationalHourToTime,
  formatShortTime,
  formatOperationalHour,
  getTimelineTopPx,
  getTimelineHeightPx,
  isBookingDraggable,
} from './schedulerUtils';
import { OPS_LAYOUT } from './operationsLayout.constants';
import type { ActiveDragState } from './useBookingDragReschedule';
import { cn } from '@/lib/utils';

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

interface DragHandlers {
  activeDrag: ActiveDragState | null;
  dragPressBookingId: number | null;
  onCardPointerDown: (
    e: React.PointerEvent,
    item: TimelineItem,
    empId: number,
    empName: string,
    laneEl: HTMLElement,
    cardTopPx: number,
    cardHeightPx: number,
  ) => void;
  shouldSuppressCardClick: () => boolean;
  onOpenTimeAdjust?: (item: TimelineItem) => void;
}

interface CutPasteHandlers {
  moveSession: BookingMoveSession | null;
  isCommitting: boolean;
  pasteSlots: PasteCandidateSlot[];
  onCut: (item: TimelineItem) => void;
  onSelectPaste: (slot: PasteCandidateSlot) => void;
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
  fullWidth?: boolean;
  showLaneHeader?: boolean;
  className?: string;
  drag?: DragHandlers;
  cutPaste?: CutPasteHandlers;
}

const SCHEDULED_TYPES = new Set<TimelineItem['type']>(['booking', 'queue', 'in_service']);

export function BarberLane({
  barber,
  headerHeight = OPS_LAYOUT.HEADER_HEIGHT,
  onItemClick,
  voiceEnabled,
  onReannounce,
  onEmptyCellClick,
  onFreeSegmentClick,
  currentDate,
  color,
  fullWidth = false,
  showLaneHeader = true,
  className,
  drag,
  cutPaste,
}: Props) {
  const laneBodyRef = useRef<HTMLDivElement>(null);
  const barberColor = color || {
    bg: 'color-mix(in srgb, var(--primary) 12%, transparent)',
    border: 'color-mix(in srgb, var(--primary) 40%, transparent)',
    text: 'var(--primary)',
    dot: 'var(--primary)',
    label: 'primary',
  };
  const hours = generateOperationalHours();
  const laneHeight = hours.length * HOUR_CELL_HEIGHT;

  const scheduledItems = barber.timeline.filter((item) => SCHEDULED_TYPES.has(item.type));

  const [moreItemsModalOpen, setMoreItemsModalOpen] = useState(false);
  const [selectedCellItems, setSelectedCellItems] = useState<TimelineItem[]>([]);
  const [selectedHourLabel, setSelectedHourLabel] = useState<string>('');

  const getStatusColor = () => {
    if (barber.status === 'day_off') return 'var(--destructive)';
    if (barber.status === 'off') return 'var(--warning)';
    return 'var(--success)';
  };

  const getStatusLabel = () => {
    if (barber.status === 'day_off') return 'إجازة';
    if (barber.status === 'off') return 'خارج ساعات العمل';
    if (barber.status === 'absent') return 'غائب';
    if (barber.status === 'not_checked_in') return 'لم يسجل حضور';
    return 'نشط';
  };

  const showLanePreview =
    drag?.activeDrag
    && drag.activeDrag.empId === barber.empId
    && !drag.activeDrag.isCommitting;

  const draggingBookingId =
    drag?.activeDrag?.empId === barber.empId ? drag.activeDrag.item.sourceId : null;

  const moveModeActive = !!cutPaste?.moveSession;
  const movedBookingId = cutPaste?.moveSession?.appointmentId ?? null;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col border-border/50',
        fullWidth ? 'w-full flex-1' : 'flex-1 shrink-0',
        className,
      )}
      style={{
        minWidth: fullWidth ? undefined : OPS_LAYOUT.BARBER_MIN_WIDTH,
        maxWidth: fullWidth ? undefined : OPS_LAYOUT.BARBER_MAX_WIDTH,
        borderInlineStartWidth: 1,
      }}
    >
      {showLaneHeader && (
        <div
          className="sticky top-0 z-20 border-b p-3 backdrop-blur-sm"
          style={{
            height: headerHeight,
            background: barberColor.bg,
            borderColor: barberColor.border,
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-full border"
              style={{ background: barberColor.bg, borderColor: barberColor.border }}
            >
              <User className="size-4" style={{ color: barberColor.dot }} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-bold text-foreground md:text-base">
                {barber.empName}
              </h3>
              <div className="flex items-center gap-1.5 text-xs">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: getStatusColor() }}
                />
                <span className="truncate" style={{ color: barberColor.text }}>
                  {getStatusLabel()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {barber.waitingCount > 0 && (
              <div className="flex items-center gap-1 rounded-md bg-surface-muted/60 px-1.5 py-0.5">
                <Users className="size-3 text-muted-foreground" />
                <span className="text-muted-foreground">{barber.waitingCount} منتظر</span>
              </div>
            )}
            {barber.inServiceCount > 0 && (
              <div className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5">
                <Clock className="size-3 text-primary" />
                <span className="text-primary">{barber.inServiceCount} خدمة</span>
              </div>
            )}
            {barber.nextAvailableAt && barber.waitingCount === 0 && barber.inServiceCount === 0 && (
              <span className="text-success">متاح الآن</span>
            )}
          </div>
        </div>
      )}

      <div
        ref={laneBodyRef}
        className="relative flex-1"
        style={{ height: laneHeight }}
      >
        {hours.map((hour, index) => {
          const isWorkingHour =
            barber.workStart &&
            barber.workEnd &&
            isHourInRange(hour, barber.workStart, barber.workEnd, barber.isOvernightShift);

          return (
            <div
              key={hour}
              className={cn(
                'absolute inset-x-0 border-b border-border/30',
                !isWorkingHour && 'bg-background/40',
              )}
              style={{
                top: index * HOUR_CELL_HEIGHT,
                height: HOUR_CELL_HEIGHT,
              }}
            >
              {scheduledItems.filter((item) => getHourKey(item.startTime) === hour).length === 0 && !moveModeActive && (
                <button
                  type="button"
                  onClick={() => onEmptyCellClick?.(hour, barber)}
                  className="group flex h-full w-full cursor-pointer items-center justify-center transition-colors hover:bg-foreground/[0.03]"
                >
                  <span className="rounded-md border border-dashed border-primary/25 bg-primary/5 px-2 py-1 text-[11px] text-primary/70 opacity-0 transition-opacity group-hover:opacity-100">
                    + حجز
                  </span>
                </button>
              )}
            </div>
          );
        })}

        {currentDate && !moveModeActive && hours.map((hour) => {
          const cellItems = scheduledItems.filter((item) => overlapsHour(item, hour));
          if (cellItems.length === 0) return null;

          const cellStart = operationalHourToTime(hour, currentDate);
          const cellEnd = operationalHourToTime(hour + 1, currentDate);
          const freeSegments = getFreeSegmentsInCell(cellStart, cellEnd, scheduledItems);

          return freeSegments.map((segment, idx) => {
            const segTop =
              getTimelineTopPx(segment.start)
              + (segment.startMinutes / 60) * HOUR_CELL_HEIGHT;

            return (
              <button
                key={`${hour}-free-${idx}`}
                type="button"
                onClick={() => onFreeSegmentClick?.(segment, barber, hour)}
                className="absolute inset-x-2 z-[5] flex items-center justify-center gap-1 rounded-md border border-dashed border-primary/25 bg-primary/5 px-2 text-[10px] text-primary/80 transition-colors hover:bg-primary/10"
                style={{
                  top: segTop,
                  height: Math.max((segment.durationMinutes / 60) * HOUR_CELL_HEIGHT - 4, 24),
                }}
                title={`حجز من ${formatShortTime(segment.start)} إلى ${formatShortTime(segment.end)}`}
              >
                <span>+ حجز</span>
                <span className="opacity-70">{formatShortTime(segment.start)}</span>
              </button>
            );
          });
        })}

        {scheduledItems.map((item, idx) => {
          const top = getTimelineTopPx(item.startTime);
          const height = getTimelineHeightPx(item.durationMinutes ?? 30);
          const draggable = isBookingDraggable(item);
          const isDragging = draggingBookingId === item.sourceId;
          const isDragPending = drag?.dragPressBookingId === item.sourceId;
          const isBeingMoved = movedBookingId === item.sourceId;
          const showCut = draggable && !!cutPaste && (!moveModeActive || isBeingMoved);

          return (
            <div
              key={`${item.type}-${item.sourceId}-${idx}`}
              className="absolute inset-x-1.5 z-10"
              style={{ top, height, minHeight: 48 }}
            >
              <HourCellCard
                item={item}
                compact={height < 56}
                onClick={onItemClick}
                voiceEnabled={voiceEnabled}
                onReannounce={onReannounce}
                barberColor={barberColor}
                draggable={draggable && !!drag && !moveModeActive}
                dragDisabledReason={
                  item.type === 'booking' && !draggable
                    ? 'لا يمكن نقل هذا الموعد'
                    : undefined
                }
                isDragging={isDragging}
                isDragPending={isDragPending}
                isBeingMoved={isBeingMoved}
                isCutActive={isBeingMoved && moveModeActive}
                cutEnabled={showCut}
                onCutClick={
                  showCut
                    ? () => cutPaste!.onCut(item)
                    : undefined
                }
                className="h-full"
                style={{ minHeight: '100%' }}
                shouldSuppressClick={drag?.shouldSuppressCardClick}
                onCardPointerDown={
                  drag && draggable && laneBodyRef.current
                    ? (e) =>
                        drag.onCardPointerDown(
                          e,
                          item,
                          barber.empId,
                          barber.empName,
                          laneBodyRef.current!,
                          top,
                          height,
                        )
                    : undefined
                }
                onOpenTimeAdjust={
                  drag?.onOpenTimeAdjust && draggable
                    ? () => drag.onOpenTimeAdjust?.(item)
                    : undefined
                }
              />
            </div>
          );
        })}

        {moveModeActive && cutPaste && (
          <BookingPasteTargets
            slots={cutPaste.pasteSlots}
            moveEmpId={cutPaste.moveSession!.originalEmpId}
            isCommitting={cutPaste.isCommitting}
            onSelect={cutPaste.onSelectPaste}
          />
        )}

        {showLanePreview && drag?.activeDrag && (
          <BookingDragPreview drag={drag.activeDrag} />
        )}
      </div>

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

function getHourKey(dateTime: string): number {
  const date = new Date(dateTime);
  const hour = date.getHours();
  const minute = date.getMinutes();
  if (hour >= 0 && hour <= 4) return Math.floor(24 + hour + minute / 60);
  return hour;
}

function overlapsHour(item: TimelineItem, hour: number): boolean {
  const startHour = getHourKey(item.startTime);
  const endHour = getHourKey(item.endTime);
  if (endHour < startHour) return hour >= startHour || hour <= endHour;
  return hour >= startHour && hour < Math.ceil(endHour + 0.001);
}

function isHourInRange(
  hour: number,
  workStart: string,
  workEnd: string,
  isOvernight: boolean,
): boolean {
  const startHour = parseInt(workStart.split(':')[0], 10);
  let endHour = parseInt(workEnd.split(':')[0], 10);

  if (isOvernight && endHour <= 4) {
    endHour += 24;
  }

  if (isOvernight) {
    return hour >= startHour || hour <= endHour;
  }

  return hour >= startHour && hour <= endHour;
}
