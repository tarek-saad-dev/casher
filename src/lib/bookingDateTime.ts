/**
 * bookingDateTime.ts
 *
 * Centralized Cairo timezone handling for bookings.
 * All booking times must be treated as Africa/Cairo time.
 * SQL Server datetime values must not be accidentally converted as UTC.
 */

import { salonDateTimeToMs, timeInTimezone } from "./publicBookingHelpers";

export const SALON_TZ = "Africa/Cairo";

export interface NormalizedBookingTimes {
  // ISO strings for backend/frontend communication
  startDateTimeCairo: string; // Full ISO with correct offset
  endDateTimeCairo: string;   // Full ISO with correct offset

  // Display strings (Arabic format)
  startTimeDisplay: string;   // "10:30 م" or "10:30 PM"
  endTimeDisplay: string;     // "11:00 م" or "11:00 PM"
  dateDisplay: string;        // "2026-06-12" or "١٢/٠٦/٢٠٢٦"

  // Duration
  durationMinutes: number;

  // For debugging
  _rawStartTime?: string;
  _rawEndTime?: string;
  _rawBookingDate?: string;
}

/**
 * Convert SQL TIME column value to HH:MM string.
 * SQL Server returns TIME as Date object anchored to 1970-01-01 UTC.
 */
export function sqlTimeToHhmm(sqlTime: unknown): string {
  if (!sqlTime) return "00:00";

  if (typeof sqlTime === "string") {
    // Already a string like "22:30:00" or "22:30"
    return sqlTime.slice(0, 5);
  }

  if (sqlTime instanceof Date) {
    // SQL TIME comes as Date with UTC hours representing the time
    const h = String(sqlTime.getUTCHours()).padStart(2, "0");
    const m = String(sqlTime.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  return "00:00";
}

/**
 * Convert SQL DATE column value to YYYY-MM-DD string.
 */
export function sqlDateToYyyyMmDd(sqlDate: unknown): string {
  if (!sqlDate) {
    const now = new Date();
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: SALON_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }

  if (typeof sqlDate === "string") {
    // Handle "2026-06-12" or "2026-06-12T00:00:00.000Z"
    return sqlDate.split("T")[0];
  }

  if (sqlDate instanceof Date) {
    // Format to YYYY-MM-DD in Cairo timezone
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: SALON_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(sqlDate);
  }

  return String(sqlDate).split("T")[0];
}

/**
 * Create a proper Date object from booking date and time in Cairo timezone.
 * This ensures the time is interpreted as Cairo time, not local/UTC.
 */
export function createCairoDateTime(
  bookingDate: unknown,
  startTime: unknown,
): Date {
  const dateStr = sqlDateToYyyyMmDd(bookingDate);
  const timeStr = sqlTimeToHhmm(startTime);

  // Use salonDateTimeToMs which handles timezone offset correctly
  const epochMs = salonDateTimeToMs(dateStr, timeStr, SALON_TZ);
  return new Date(epochMs);
}

/**
 * Calculate end time from start time and duration.
 * Handles overnight bookings correctly.
 */
export function calculateEndTime(
  startDateTime: Date,
  durationMinutes: number,
): Date {
  return new Date(startDateTime.getTime() + durationMinutes * 60000);
}

/**
 * Format time for Arabic display (12-hour with م/ص suffix).
 */
export function formatTimeArabic(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("ar-EG", {
      timeZone: SALON_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);

    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value ?? "";

    // Normalize day period
    const period = dayPeriod.includes("ص") ? "ص" : dayPeriod.includes("م") ? "م" : dayPeriod;

    return `${hour}:${minute} ${period}`;
  } catch {
    // Fallback
    return timeInTimezone(date, SALON_TZ);
  }
}

/**
 * Format date for Arabic display.
 */
export function formatDateArabic(date: Date): string {
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      timeZone: SALON_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    // Fallback
    return date.toLocaleDateString("ar-EG");
  }
}

/**
 * Main function to normalize booking times from SQL data.
 * This should be called in all booking APIs before returning data.
 */
export function normalizeBookingTimes(
  bookingDate: unknown,
  startTime: unknown,
  endTime: unknown | null,
  totalDurationMinutes: number,
  bookingId?: number, // for debug logging
): NormalizedBookingTimes {
  // DEBUG logging for specific bookings
  const isDebugBooking = bookingId && (bookingId === 448 || bookingId.toString().includes("448"));

  if (isDebugBooking) {
    console.log(`[BK-${bookingId}] RAW DATA:`, {
      bookingDate,
      startTime,
      endTime,
      totalDurationMinutes,
      types: {
        bookingDate: typeof bookingDate,
        startTime: typeof startTime,
        endTime: typeof endTime,
      },
    });
  }

  // Convert to normalized strings
  const dateStr = sqlDateToYyyyMmDd(bookingDate);
  const startTimeStr = sqlTimeToHhmm(startTime);

  if (isDebugBooking) {
    console.log(`[BK-${bookingId}] PARSED:`, {
      dateStr,
      startTimeStr,
    });
  }

  // Create Cairo-normalized start datetime
  const startDateTimeCairo = createCairoDateTime(bookingDate, startTime);

  if (isDebugBooking) {
    console.log(`[BK-${bookingId}] START DATETIME:`, {
      iso: startDateTimeCairo.toISOString(),
      localString: startDateTimeCairo.toLocaleString("ar-EG", { timeZone: SALON_TZ }),
      utcHours: startDateTimeCairo.getUTCHours(),
      utcMinutes: startDateTimeCairo.getUTCMinutes(),
    });
  }

  // Calculate or parse end time
  let endDateTimeCairo: Date;

  if (endTime) {
    // If we have a stored EndTime, try to use it
    const endTimeStr = sqlTimeToHhmm(endTime);
    const endFromSql = createCairoDateTime(bookingDate, endTime);

    // Validate: end must be after start
    if (endFromSql.getTime() > startDateTimeCairo.getTime()) {
      endDateTimeCairo = endFromSql;
    } else {
      // End is before start (overnight or data error), add duration instead
      endDateTimeCairo = calculateEndTime(startDateTimeCairo, totalDurationMinutes);
    }
  } else {
    // Calculate from duration
    endDateTimeCairo = calculateEndTime(startDateTimeCairo, totalDurationMinutes);
  }

  // Validate end time is after start time
  if (endDateTimeCairo.getTime() <= startDateTimeCairo.getTime()) {
    console.warn(`[Booking${bookingId ? ` ${bookingId}` : ""}] EndTime <= StartTime, recalculating from duration`);
    endDateTimeCairo = calculateEndTime(startDateTimeCairo, totalDurationMinutes);
  }

  // Calculate actual duration from the times
  const actualDurationMinutes = Math.round(
    (endDateTimeCairo.getTime() - startDateTimeCairo.getTime()) / 60000
  );

  // Log warning if duration doesn't match
  if (Math.abs(actualDurationMinutes - totalDurationMinutes) > 1) {
    console.warn(
      `[Booking${bookingId ? ` ${bookingId}` : ""}] Duration mismatch: ` +
      `services=${totalDurationMinutes}min, calculated=${actualDurationMinutes}min`
    );
  }

  if (isDebugBooking) {
    console.log(`[BK-${bookingId}] END DATETIME:`, {
      iso: endDateTimeCairo.toISOString(),
      localString: endDateTimeCairo.toLocaleString("ar-EG", { timeZone: SALON_TZ }),
      actualDurationMinutes,
    });
  }

  return {
    startDateTimeCairo: startDateTimeCairo.toISOString(),
    endDateTimeCairo: endDateTimeCairo.toISOString(),
    startTimeDisplay: formatTimeArabic(startDateTimeCairo),
    endTimeDisplay: formatTimeArabic(endDateTimeCairo),
    dateDisplay: formatDateArabic(startDateTimeCairo),
    durationMinutes: actualDurationMinutes,
    // Debug info
    ...(isDebugBooking && {
      _rawStartTime: String(startTime),
      _rawEndTime: String(endTime),
      _rawBookingDate: String(bookingDate),
    }),
  };
}

/**
 * Create a booking interval for conflict detection.
 * Returns start/end Date objects that can be compared with other intervals.
 */
export function createBookingInterval(
  bookingDate: unknown,
  startTime: unknown,
  endTime: unknown | null,
  durationMinutes: number,
): { start: Date; end: Date } {
  const normalized = normalizeBookingTimes(bookingDate, startTime, endTime, durationMinutes);
  return {
    start: new Date(normalized.startDateTimeCairo),
    end: new Date(normalized.endDateTimeCairo),
  };
}
