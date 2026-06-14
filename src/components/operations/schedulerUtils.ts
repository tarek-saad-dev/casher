/**
 * Scheduler utility functions for operational hours (11 AM - 4 AM next day)
 */

export const OPERATION_START_HOUR = 11;
export const OPERATION_END_HOUR = 28; // 4 AM next day (24 + 4)
export const HOUR_CELL_HEIGHT = 120; // px

export interface TimelineItem {
  type: "queue" | "booking" | "gap" | "in_service";
  sourceId: number;
  label: string;
  startTime: string;
  endTime: string;
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
  const date = new Date(dateTime);
  const hour = date.getHours();
  const minute = date.getMinutes();

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
  const date = new Date(dateTime);
  const hours = date.getHours();
  const minutes = date.getMinutes();

  let displayHour: number;
  if (hours === 0) displayHour = 12;
  else if (hours > 12) displayHour = hours - 12;
  else displayHour = hours;

  return `${displayHour}:${minutes.toString().padStart(2, "0")}`;
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

/**
 * Convert operational hour back to time string for a given date
 */
export function operationalHourToTime(hour: number, dateStr: string): string {
  let actualHour: number;

  if (hour >= 24) {
    // Next day
    actualHour = hour - 24;
  } else {
    actualHour = hour;
  }

  return `${dateStr}T${actualHour.toString().padStart(2, "0")}:00:00`;
}
