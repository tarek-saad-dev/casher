/**
 * Guard against AM/PM check-in mistakes.
 *
 * Employees whose default (or scheduled) start is in the afternoon/evening (PM)
 * are easy to check in for the WRONG half of the day: an operator picks 5:00 ص
 * (05:00) in the <input type="time"> when they meant 5:00 م (17:00).
 *
 * This module detects that specific, high-confidence mistake and proposes the
 * corrected PM time. It intentionally does NOT flag legitimate overnight shifts
 * (evening start + early-morning arrival), which are handled by calcLateMinutes.
 */

import { parseTimeToMinutes, sqlTimeToHHmm } from '@/lib/timeUtils';

const NOON_MIN = 12 * 60;            // 12:00 — boundary between AM and PM
const OVERNIGHT_REF_MIN = 18 * 60;   // reference start ≥ 18:00 → possible overnight shift
const OVERNIGHT_ARRIVAL_MAX = 6 * 60; // arrival < 06:00 → legit next-morning crossover

export interface CheckInPeriodCheck {
  /** True when a PM default is paired with an AM check-in (likely a mistake). */
  mismatch: boolean;
  /** Normalised entered check-in "HH:mm" (or null). */
  checkIn: string | null;
  /** Normalised reference "HH:mm" the check-in is compared against (or null). */
  reference: string | null;
  /** Suggested corrected check-in "HH:mm" (entered + 12h), or null. */
  suggested: string | null;
}

const NO_MISMATCH = (checkIn: string | null, reference: string | null): CheckInPeriodCheck => ({
  mismatch: false,
  checkIn,
  reference,
  suggested: null,
});

/**
 * Compare an entered check-in against a reference time (employee default
 * check-in, falling back to scheduled start) and flag a probable AM/PM slip.
 */
export function detectCheckInPeriodMismatch(
  checkInValue: unknown,
  referenceValue: unknown,
): CheckInPeriodCheck {
  const checkIn = sqlTimeToHHmm(checkInValue);
  const reference = sqlTimeToHHmm(referenceValue);
  const checkInMin = parseTimeToMinutes(checkIn);
  const referenceMin = parseTimeToMinutes(reference);

  if (checkIn == null || reference == null || checkInMin == null || referenceMin == null) {
    return NO_MISMATCH(checkIn, reference);
  }

  const referenceIsPm = referenceMin >= NOON_MIN;
  const checkInIsAm = checkInMin < NOON_MIN;

  // Legit overnight crossover — evening shift with an early-morning arrival.
  const overnightCrossover =
    referenceMin >= OVERNIGHT_REF_MIN && checkInMin < OVERNIGHT_ARRIVAL_MAX;

  if (!referenceIsPm || !checkInIsAm || overnightCrossover) {
    return NO_MISMATCH(checkIn, reference);
  }

  const suggestedMin = checkInMin + NOON_MIN;
  const suggested =
    suggestedMin < 24 * 60
      ? `${String(Math.floor(suggestedMin / 60)).padStart(2, '0')}:${String(suggestedMin % 60).padStart(2, '0')}`
      : null;

  return { mismatch: true, checkIn, reference, suggested };
}

/** Format an "HH:mm" (24h) value as Arabic 12h, e.g. "5:00 م". */
export function formatClockAr(value: unknown): string {
  const hhmm = sqlTimeToHHmm(value);
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}
