/**
 * Phase 1O — overnight operating-hours helpers (pure).
 * Open 11:00 → close 01:30 next calendar day; WorkDate uses business-day cutoff.
 */
export type OvernightHoursConfig = {
  openTime: string; // HH:mm or HH:mm:ss
  closeTime: string;
  /** Minutes from midnight after which calendar day rolls for WorkDate (e.g. 04:00 → 240). */
  businessDayCutoffMinutes: number;
};

export type SlotAvailability = {
  available: boolean;
  /** 0 = same calendar day as operating day; 1 = next calendar day (after midnight). */
  dayOffset: 0 | 1;
  reason?: string;
};

function parseHm(value: string): number {
  const parts = String(value).trim().split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    throw new Error(`Invalid time: ${value}`);
  }
  return h * 60 + m;
}

function formatHm(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Expand overnight window to exclusive end on a continuous minute timeline.
 * Example: open 11:00, close 01:30 → [660, 1530) where 1530 = 24*60 + 90.
 */
export function overnightWindowMinutes(cfg: OvernightHoursConfig): {
  openMin: number;
  closeExclusiveMin: number;
  spansMidnight: boolean;
} {
  const openMin = parseHm(cfg.openTime);
  const closeMin = parseHm(cfg.closeTime);
  const spansMidnight = closeMin <= openMin;
  const closeExclusiveMin = spansMidnight ? closeMin + 24 * 60 : closeMin;
  return { openMin, closeExclusiveMin, spansMidnight };
}

/**
 * Is clock time a valid booking/ops start for the overnight salon hours?
 * Closing boundary is exclusive (01:30 is not available as a start).
 */
export function evaluateOvernightSlot(
  clockTime: string,
  cfg: OvernightHoursConfig,
): SlotAvailability {
  const t = parseHm(clockTime);
  const { openMin, closeExclusiveMin, spansMidnight } = overnightWindowMinutes(cfg);

  if (!spansMidnight) {
    if (t < openMin) return { available: false, dayOffset: 0, reason: 'before_open' };
    if (t >= closeExclusiveMin) {
      return { available: false, dayOffset: 0, reason: 'at_or_after_close' };
    }
    return { available: true, dayOffset: 0 };
  }

  // Overnight: [open, 24:00) dayOffset 0; [00:00, close) dayOffset 1
  if (t >= openMin) {
    return { available: true, dayOffset: 0 };
  }
  if (t < parseHm(cfg.closeTime)) {
    return { available: true, dayOffset: 1 };
  }
  return { available: false, dayOffset: 0, reason: 'outside_overnight_window' };
}

/**
 * Map a wall-clock instant to WorkDate given business-day cutoff.
 * Times before cutoff belong to the previous calendar day's WorkDate.
 */
export function workDateForInstant(
  calendarDateIso: string,
  clockTime: string,
  cutoffMinutes: number,
): string {
  const t = parseHm(clockTime);
  if (t < cutoffMinutes) {
    const d = new Date(`${calendarDateIso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return calendarDateIso;
}

/**
 * Operating day for an overnight slot: when dayOffset=1, the operating day is the previous calendar date.
 */
export function operatingDayForSlot(
  selectedDateIso: string,
  dayOffset: 0 | 1,
): string {
  if (dayOffset === 0) return selectedDateIso;
  const d = new Date(`${selectedDateIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const CAMP_CAESAR_OVERNIGHT_HOURS: OvernightHoursConfig = {
  openTime: '11:00',
  closeTime: '01:30',
  businessDayCutoffMinutes: 4 * 60, // 04:00 — matches Camp Caesar BusinessDayCutoffTime
};

export function assertCampCaesarOvernightBoundaries(): Array<{
  time: string;
  expectedAvailable: boolean;
  expectedDayOffset?: 0 | 1;
}> {
  const cases: Array<{
    time: string;
    expectedAvailable: boolean;
    expectedDayOffset?: 0 | 1;
  }> = [
    { time: '10:59', expectedAvailable: false },
    { time: '11:00', expectedAvailable: true, expectedDayOffset: 0 },
    { time: '23:45', expectedAvailable: true, expectedDayOffset: 0 },
    { time: '00:30', expectedAvailable: true, expectedDayOffset: 1 },
    { time: '01:15', expectedAvailable: true, expectedDayOffset: 1 },
    { time: '01:30', expectedAvailable: false },
    { time: '02:00', expectedAvailable: false },
  ];
  for (const c of cases) {
    const r = evaluateOvernightSlot(c.time, CAMP_CAESAR_OVERNIGHT_HOURS);
    if (r.available !== c.expectedAvailable) {
      throw new Error(
        `Overnight boundary fail at ${c.time}: available=${r.available} expected=${c.expectedAvailable}`,
      );
    }
    if (
      c.expectedAvailable &&
      c.expectedDayOffset != null &&
      r.dayOffset !== c.expectedDayOffset
    ) {
      throw new Error(
        `Overnight dayOffset fail at ${c.time}: got ${r.dayOffset} expected ${c.expectedDayOffset}`,
      );
    }
  }
  return cases;
}

export { parseHm, formatHm };
