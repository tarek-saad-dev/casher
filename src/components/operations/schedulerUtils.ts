/**
 * Scheduler utility functions for operational hours (11 AM - 4 AM next day)
 */

export const OPERATION_START_HOUR = 11;
export const OPERATION_END_HOUR = 28; // 4 AM next day (24 + 4)
export const HOUR_CELL_HEIGHT = 120; // px
export const BUSINESS_DAY_CUTOFF_HOUR = 4;
export const SLOT_INTERVAL_MINUTES = 15;
export const PX_PER_MINUTE = HOUR_CELL_HEIGHT / 60;
export const DRAG_ACTIVATION_PX = 4;
export const LARGE_MOVE_CONFIRM_MINUTES = 30;
export const UNDO_TIMEOUT_MS = 10000;

export interface CairoTimeParts {
  hour: number;
  minute: number;
  calendarDate: string;
}

export interface TimelineBarber {
  timeline: TimelineItem[];
}

export interface TimelineItem {
  type: "queue" | "booking" | "gap" | "in_service";
  sourceId: number;
  label: string;
  startTime: string; // ISO datetime
  endTime: string;   // ISO datetime
  status: string;
  protected: boolean;
  durationMinutes?: number;
  customerName?: string;
  serviceNames?: string[];
  ticketCode?: string;
  barberId?: number;
  // Lifecycle fields (from queueLifecycleEngine)
  effectiveStatus?: string;
  actualStatus?: string;
  needsOperatorAction?: boolean;
  overdueMinutes?: number;
  expectedStartAt?: string;
  expectedEndAt?: string;
  isCountingAhead?: boolean;
  isBlockingAvailability?: boolean;
  // Normalized Cairo time display fields (preferred for display)
  startTimeDisplay?: string; // e.g., "10:30 م"
  endTimeDisplay?: string;   // e.g., "11:00 م"
  dateDisplay?: string;      // e.g., "2026-06-12"
}

/** Calendar date in Africa/Cairo (YYYY-MM-DD) */
export function getCairoCalendarDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

/** Operational business date — before 4 AM Cairo belongs to the previous operational day */
export function getCairoBusinessDate(): string {
  const now = new Date();
  const cairoHour = parseInt(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      hour12: false,
    }).format(now),
    10,
  );

  if (cairoHour < BUSINESS_DAY_CUTOFF_HOUR) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  }

  return getCairoCalendarDate();
}

export function getCairoTimeParts(): CairoTimeParts {
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
  const day = parseInt(get('day'), 10);
  const month = parseInt(get('month'), 10);
  const year = parseInt(get('year'), 10);

  return {
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    calendarDate: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
  };
}

/** Wall-clock Cairo time → operational hour (11..28, with fractional minutes) */
export function wallClockToOperationalHour(hour: number, minute: number): number {
  if (hour >= 0 && hour <= 4) {
    return 24 + hour + minute / 60;
  }
  return hour + minute / 60;
}

export function operationalHourToScrollY(
  operationalHour: number,
  headerHeight: number,
): number {
  const hourOffset = operationalHour - OPERATION_START_HOUR;
  return headerHeight + hourOffset * HOUR_CELL_HEIGHT;
}

export function getCurrentTimeScrollY(headerHeight: number): number | null {
  const { hour, minute } = getCairoTimeParts();
  const operationalHour = wallClockToOperationalHour(hour, minute);

  if (operationalHour < OPERATION_START_HOUR || operationalHour > OPERATION_END_HOUR) {
    return null;
  }

  return operationalHourToScrollY(operationalHour, headerHeight);
}

const SCHEDULED_ITEM_TYPES = new Set<TimelineItem['type']>([
  'booking',
  'queue',
  'in_service',
]);

export function getEarliestScheduledScrollY(
  barbers: TimelineBarber[],
  headerHeight: number,
): number | null {
  let earliest: number | null = null;

  for (const barber of barbers) {
    for (const item of barber.timeline) {
      if (!SCHEDULED_ITEM_TYPES.has(item.type)) continue;
      const y = operationalHourToScrollY(getOperationalHour(item.startTime), headerHeight);
      if (earliest === null || y < earliest) {
        earliest = y;
      }
    }
  }

  return earliest;
}

export function resolveTimelineTargetScrollY(
  selectedDate: string,
  barbers: TimelineBarber[],
  headerHeight: number,
): number {
  if (selectedDate === getCairoBusinessDate()) {
    return getCurrentTimeScrollY(headerHeight)
      ?? operationalHourToScrollY(OPERATION_START_HOUR, headerHeight);
  }

  return (
    getEarliestScheduledScrollY(barbers, headerHeight)
    ?? operationalHourToScrollY(OPERATION_START_HOUR, headerHeight)
  );
}

export function computeAnchoredScrollTop(
  targetY: number,
  viewportHeight: number,
  contentHeight: number,
  anchor = 0.3,
): number {
  const desiredTop = targetY - viewportHeight * anchor;
  const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, Math.min(desiredTop, maxScrollTop));
}

const MOBILE_ALL_CARD_GAP = 16;
const MOBILE_ALL_CONTAINER_PAD = 8;

export function resolveMobileAllScrollTargetY(
  selectedDate: string,
  barbers: TimelineBarber[],
  headerHeight: number,
  laneHeight: number,
): number {
  if (selectedDate === getCairoBusinessDate()) {
    const currentY = getCurrentTimeScrollY(headerHeight);
    return MOBILE_ALL_CONTAINER_PAD + (currentY ?? headerHeight);
  }

  let best: number | null = null;

  barbers.forEach((barber, index) => {
    const cardTop = MOBILE_ALL_CONTAINER_PAD + index * (laneHeight + MOBILE_ALL_CARD_GAP);

    for (const item of barber.timeline) {
      if (!SCHEDULED_ITEM_TYPES.has(item.type)) continue;
      const y = operationalHourToScrollY(getOperationalHour(item.startTime), headerHeight);
      const absoluteY = cardTop + y;
      if (best === null || absoluteY < best) {
        best = absoluteY;
      }
    }
  });

  if (best !== null) return best;

  return MOBILE_ALL_CONTAINER_PAD + operationalHourToScrollY(OPERATION_START_HOUR, headerHeight);
}

/**
 * Generate operational hours array [11, 12, 13, ..., 28]
 */
export function generateOperationalHours(): number[] {
  const hours: number[] = [];
  for (let h = OPERATION_START_HOUR; h <= OPERATION_END_HOUR; h++) {
    hours.push(h);
  }
  return hours;
}

/**
 * Format operational hour for display
 * 11 => "11 AM"
 * 12 => "12 PM"
 * 13 => "1 PM"
 * 23 => "11 PM"
 * 24 => "12 AM"
 * 25 => "1 AM"
 * 28 => "4 AM"
 */
export function formatOperationalHour(hour: number): string {
  if (hour >= 24) {
    // Next day hours (12 AM - 4 AM)
    const displayHour = hour - 24;
    return `${displayHour === 0 ? 12 : displayHour} AM`;
  }

  if (hour === 12) return "12 PM";
  if (hour > 12) return `${hour - 12} PM`;
  return `${hour} AM`;
}

/**
 * Convert ISO datetime to operational hour
 * 00:00 => 24
 * 00:30 => 24.5
 * 01:00 => 25
 * 02:00 => 26
 * 03:00 => 27
 * 04:00 => 28
 * 11:00 => 11
 * 14:30 => 14.5
 */
export function getOperationalHour(dateTime: string | Date): number {
  const { hour, minute } = getCairoHourMinute(dateTime);

  // After midnight (0-4 AM) = next day operational hours
  if (hour >= 0 && hour <= 4) {
    return 24 + hour + minute / 60;
  }

  return hour + minute / 60;
}

/**
 * Get hour key for grouping (floor of operational hour)
 */
export function getHourKey(dateTime: string | Date): number {
  return Math.floor(getOperationalHour(dateTime));
}

/**
 * Group timeline items by operational hour
 */
export function groupItemsByHour(items: TimelineItem[]): Map<number, TimelineItem[]> {
  const groups = new Map<number, TimelineItem[]>();

  for (const item of items) {
    const hourKey = getHourKey(item.startTime);

    if (!groups.has(hourKey)) {
      groups.set(hourKey, []);
    }
    groups.get(hourKey)!.push(item);
  }

  // Sort items within each hour by start time
  for (const [hour, items] of groups) {
    items.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }

  return groups;
}

/**
 * Free time segment within a cell
 */
export interface FreeSegment {
  start: string; // ISO datetime
  end: string;   // ISO datetime
  startMinutes: number; // minutes from cell start (for positioning)
  durationMinutes: number;
}

/**
 * Calculate free time segments within a cell (1-hour period)
 * given a list of busy events (bookings, queue items, etc.)
 *
 * @param cellStart - ISO datetime string for cell start (e.g., "2024-01-15T18:00:00")
 * @param cellEnd - ISO datetime string for cell end (e.g., "2024-01-15T19:00:00")
 * @param events - Array of timeline items that might overlap with the cell
 * @returns Array of free segments within the cell
 */
export function getFreeSegmentsInCell(
  cellStart: string,
  cellEnd: string,
  events: TimelineItem[]
): FreeSegment[] {
  const cellStartMs = new Date(cellStart).getTime();
  const cellEndMs = new Date(cellEnd).getTime();
  const cellDurationMs = cellEndMs - cellStartMs;

  // Filter events that overlap with this cell and clip to cell boundaries
  const busySegments = events
    .filter(event => {
      const eventStartMs = new Date(event.startTime).getTime();
      const eventEndMs = new Date(event.endTime).getTime();
      // Event overlaps if it starts before cell ends AND ends after cell starts
      return eventStartMs < cellEndMs && eventEndMs > cellStartMs;
    })
    .map(event => {
      const eventStartMs = new Date(event.startTime).getTime();
      const eventEndMs = new Date(event.endTime).getTime();
      return {
        startMs: Math.max(eventStartMs, cellStartMs),
        endMs: Math.min(eventEndMs, cellEndMs),
      };
    })
    .sort((a, b) => a.startMs - b.startMs);

  // Merge overlapping busy segments
  const mergedBusy: { startMs: number; endMs: number }[] = [];
  for (const segment of busySegments) {
    if (mergedBusy.length === 0) {
      mergedBusy.push(segment);
    } else {
      const last = mergedBusy[mergedBusy.length - 1];
      if (segment.startMs <= last.endMs) {
        // Overlaps or touches - merge
        last.endMs = Math.max(last.endMs, segment.endMs);
      } else {
        mergedBusy.push(segment);
      }
    }
  }

  // Calculate free segments by subtracting busy from cell
  const freeSegments: FreeSegment[] = [];
  let cursorMs = cellStartMs;

  for (const busy of mergedBusy) {
    if (busy.startMs > cursorMs) {
      // There's a gap before this busy segment
      const start = new Date(cursorMs).toISOString();
      const end = new Date(busy.startMs).toISOString();
      const startMinutes = (cursorMs - cellStartMs) / 60000;
      const durationMinutes = (busy.startMs - cursorMs) / 60000;

      freeSegments.push({
        start,
        end,
        startMinutes,
        durationMinutes,
      });
    }
    cursorMs = Math.max(cursorMs, busy.endMs);
  }

  // Check for free time after last busy segment
  if (cursorMs < cellEndMs) {
    const start = new Date(cursorMs).toISOString();
    const end = new Date(cellEndMs).toISOString();
    const startMinutes = (cursorMs - cellStartMs) / 60000;
    const durationMinutes = (cellEndMs - cursorMs) / 60000;

    freeSegments.push({
      start,
      end,
      startMinutes,
      durationMinutes,
    });
  }

  return freeSegments;
}

/**
 * Format time range for display
 * "2:00 - 2:30"
 */
export function formatTimeRange(startTime: string, endTime: string): string {
  const start = formatShortTime(startTime);
  const end = formatShortTime(endTime);
  return `${start} - ${end}`;
}

/**
 * Format short time (e.g., "2:00", "11:30")
 */
export function formatShortTime(dateTime: string | Date): string {
  const { hour: hours, minute } = getCairoHourMinute(dateTime);

  let displayHour: number;
  if (hours === 0) displayHour = 12;
  else if (hours > 12) displayHour = hours - 12;
  else displayHour = hours;

  return `${displayHour}:${minute.toString().padStart(2, "0")}`;
}

/**
 * Get display label for item type
 */
export function getItemTypeLabel(type: string, isProtected?: boolean): string {
  if (type === "in_service") return "قيد الخدمة";
  if (type === "booking") {
    return isProtected ? "حجز محمي" : "حجز";
  }
  if (type === "queue") return "دور";
  return type;
}

/**
 * Check if operational hour is within working range
 */
export function isWithinOperationalHours(hour: number): boolean {
  // Hours 11-23 (same day) and 24-28 (next day 0-4 AM)
  return hour >= OPERATION_START_HOUR && hour <= OPERATION_END_HOUR;
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function getCairoHourMinute(dateTime: string | Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(dateTime));
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return { hour: h, minute: m };
}

/**
 * Convert operational hour back to time string for a given date
 */
export function operationalHourToTime(hour: number, dateStr: string): string {
  let actualHour: number;
  let actualDate: string;

  if (hour >= 24) {
    // Next operational day (after midnight)
    actualHour = hour - 24;
    actualDate = nextDate(dateStr);
  } else {
    actualHour = hour;
    actualDate = dateStr;
  }

  return `${actualDate}T${actualHour.toString().padStart(2, "0")}:00:00`;
}

/** Top offset (px) within lane body for an ISO start time */
export function getTimelineTopPx(startTime: string | Date): number {
  const opHour = getOperationalHour(startTime);
  return (opHour - OPERATION_START_HOUR) * HOUR_CELL_HEIGHT;
}

/** Height (px) for a duration in minutes */
export function getTimelineHeightPx(durationMinutes: number): number {
  return Math.max((durationMinutes / 60) * HOUR_CELL_HEIGHT, 48);
}

/** Convert Y delta within lane to minutes delta */
export function pixelDeltaToMinutes(deltaPx: number): number {
  return (deltaPx / HOUR_CELL_HEIGHT) * 60;
}

/** Snap minutes to nearest grid interval */
export function snapMinutesToGrid(minutes: number, interval = SLOT_INTERVAL_MINUTES): number {
  return Math.round(minutes / interval) * interval;
}

/** Snap an ISO datetime by shifting minutes on operational timeline */
export function snapDateTimeByMinutes(isoStart: string, deltaMinutes: number): string {
  const startMs = new Date(isoStart).getTime();
  const startOpHour = getOperationalHour(isoStart);
  const startTotalMinutes = startOpHour * 60;
  const snapped = snapMinutesToGrid(startTotalMinutes + deltaMinutes);
  const newOpHour = snapped / 60;
  const deltaOp = newOpHour - startOpHour;
  const newMs = startMs + deltaOp * 3600000;
  return new Date(newMs).toISOString();
}

/** Format delta for UX label */
export function formatMinutesDeltaLabel(deltaMinutes: number): string {
  if (deltaMinutes === 0) return '0 دقيقة';
  const sign = deltaMinutes > 0 ? '+' : '';
  return `${sign}${deltaMinutes} دقيقة`;
}

const NON_DRAGGABLE_STATUSES = new Set([
  'in_service',
  'in_progress',
  'completed',
  'cancelled',
  'canceled',
  'no_show',
  'rescheduled',
  'finished',
  'serving',
  'deleted',
  'expired',
]);

/** Whether a booking timeline item can be vertically rescheduled */
export function isBookingDraggable(item: TimelineItem): boolean {
  if (item.type !== 'booking') return false;
  const status = (item.status || '').toLowerCase();
  if (NON_DRAGGABLE_STATUSES.has(status)) return false;
  if (!['confirmed', 'arrived', 'queued'].includes(status)) return false;
  if (!item.startTime || !item.endTime) return false;
  if (!item.durationMinutes || item.durationMinutes <= 0) return false;
  return true;
}
