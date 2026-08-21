/**
 * Pure V2 slot start helpers — safe for client + server bundles.
 * No DB / server-only imports.
 */

export const V2_SLOT_TZ = 'Africa/Cairo';

export type V2SlotStart = {
  startMin: number;
  time: string;
  dayOffset: 0 | 1;
  startAtMs: number;
};

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Salon wall-clock → epoch ms (same algorithm as publicBookingHelpers.salonDateTimeToMs). */
export function salonWallToEpochMs(
  dateStr: string,
  hhmm: string,
  tz: string = V2_SLOT_TZ,
): number {
  try {
    const [h, mi] = hhmm.split(':').map(Number);
    const noonUtc = new Date(`${dateStr}T12:00:00Z`);
    const noonLocal = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'shortOffset',
    }).formatToParts(noonUtc);
    const offsetPart =
      noonLocal.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
    const offsetMatch = offsetPart.match(/GMT([+-]\d+(?::\d+)?)/);
    let offsetMinutes = 0;
    if (offsetMatch) {
      const parts = offsetMatch[1]!.split(':');
      offsetMinutes =
        parseInt(parts[0]!, 10) * 60 +
        (parts[1]
          ? parseInt(parts[1], 10) * Math.sign(parseInt(parts[0]!, 10))
          : 0);
    }
    const midnightUtcMs = new Date(`${dateStr}T00:00:00Z`).getTime();
    return midnightUtcMs - offsetMinutes * 60_000 + (h! * 60 + mi!) * 60_000;
  } catch {
    return new Date(`${dateStr}T${hhmm}:00`).getTime();
  }
}

export function startMinToV2Slot(
  startMin: number,
  businessDate: string,
  timeZone = V2_SLOT_TZ,
): V2SlotStart {
  const dayOffset: 0 | 1 = startMin >= 1440 ? 1 : 0;
  const clock = ((startMin % 1440) + 1440) % 1440;
  const h = Math.floor(clock / 60);
  const mi = clock % 60;
  const time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  const calendarDate =
    dayOffset === 1 ? shiftYmd(businessDate, 1) : businessDate;
  const startAtMs = salonWallToEpochMs(calendarDate, time, timeZone);
  return { startMin, time, dayOffset, startAtMs };
}
