/**
 * Time utilities for SQL TIME fields.
 *
 * SQL TIME columns are returned by mssql as JavaScript Date objects anchored
 * to 1970-01-01 (e.g. 1970-01-01T13:00:00.000Z for 13:00).
 *
 * NEVER use new Date(timeString) or Date.parse() on these values on the
 * frontend — use these helpers instead.
 */

// ─── Normalise any time value to "HH:mm" ──────────────────────────────────────
// Accepts:
//   - JS Date object (from mssql TIME column)   → uses UTC hours/minutes
//   - ISO string "1970-01-01T13:00:00.000Z"     → parsed as UTC
//   - "13:00", "13:00:00", "1:00"               → split on ":"
//   - "01:00 PM", "12:00 AM"                    → AM/PM conversion
// Returns "HH:mm" or null if unparseable.
export function sqlTimeToHHmm(val: unknown): string | null {
  if (val == null) return null;

  // JS Date object (mssql driver wraps TIME as Date anchored to 1970-01-01)
  if (val instanceof Date) {
    const h = String(val.getUTCHours()).padStart(2, '0');
    const m = String(val.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  const s = String(val).trim();
  if (!s) return null;

  // ISO datetime string e.g. "1970-01-01T13:00:00.000Z"
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  // AM/PM format e.g. "01:00 PM", "12:00 AM"
  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2]);
    const period = ampm[4].toUpperCase();
    if (period === 'AM') {
      if (h === 12) h = 0;       // 12:00 AM → 00:00
    } else {
      if (h !== 12) h += 12;     // 01:00 PM → 13:00
    }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // HH:mm or HH:mm:ss
  const plain = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (plain) {
    const h = Number(plain[1]);
    const m = Number(plain[2]);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return null;
}

// ─── Parse any time value to total minutes from 00:00 ─────────────────────────
// Returns null if unparseable.
export function parseTimeToMinutes(val: unknown): number | null {
  const hhmm = sqlTimeToHHmm(val);
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ─── Format "HH:mm" (24h) to "hh:mm AM/PM" (12h) ────────────────────────────
export function formatTime12h(val: unknown): string {
  const hhmm = sqlTimeToHHmm(val);
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12    = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

// ─── Calculate late minutes (midnight-crossover safe) ─────────────────────────
// Returns 0 if employee arrived on time or early.
// Handles overnight shifts: if scheduled start is in the evening (≥18:00)
// and actual check-in is in the early morning (<06:00), the shift crosses
// midnight — actual time is treated as next-day minutes (+1440).
export function calcLateMinutes(
  checkIn: unknown,
  scheduledStart: unknown,
): number {
  const actualMin    = parseTimeToMinutes(checkIn);
  const scheduledMin = parseTimeToMinutes(scheduledStart);
  if (actualMin === null || scheduledMin === null) return 0;

  let diff = actualMin - scheduledMin;

  // Midnight-crossover: scheduled in evening, actual in early morning
  if (scheduledMin >= 18 * 60 && actualMin < 6 * 60) {
    diff = (actualMin + 1440) - scheduledMin;
  }

  return diff > 0 ? diff : 0;
}

// ─── Calculate early-leave minutes (midnight-crossover safe) ──────────────────
export function calcEarlyLeaveMinutes(
  checkOut: unknown,
  scheduledEnd: unknown,
): number {
  const actualMin    = parseTimeToMinutes(checkOut);
  const scheduledMin = parseTimeToMinutes(scheduledEnd);
  if (actualMin === null || scheduledMin === null) return 0;

  // Overnight shift: scheduled end is after midnight (< 06:00)
  if (scheduledMin < 6 * 60) {
    // If employee left before midnight (>= 18:00), they haven't reached end yet
    if (actualMin >= 18 * 60) return 0;
    // Both after midnight
    const diff = scheduledMin - actualMin;
    return diff > 0 ? diff : 0;
  }

  const diff = scheduledMin - actualMin;
  return diff > 0 ? diff : 0;
}

// ─── For <input type="time"> — returns "HH:mm" or "" ─────────────────────────
export function sqlTimeForInput(val: unknown): string {
  return sqlTimeToHHmm(val) ?? '';
}

// ─── Business Date: day ends at 05:00 (5 AM) instead of 00:00 ────────────────
// Returns YYYY-MM-DD string for the "business day" — if current time is before
// 5 AM, returns the PREVIOUS calendar date (since the business day hasn't ended yet)
export function getBusinessDateStr(cutoffHour: number = 5): string {
  const now = new Date();
  const currentHour = now.getHours();

  // If before cutoff hour (5 AM), still consider it the previous day
  if (currentHour < cutoffHour) {
    now.setDate(now.getDate() - 1);
  }

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
