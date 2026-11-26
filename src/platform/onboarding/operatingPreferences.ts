import { bookingSettingsValidationError } from '@/lib/booking/bookingSettingsValidation';

export type OperatingBookingPreferences = { slotIntervalMinutes: number; minNoticeMinutes: number; maxBookingDaysAhead: number };
export function parseOperatingBookingPreferences(raw: unknown): OperatingBookingPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('راجع إعدادات الحجز.');
  const body = raw as Record<string, unknown>;
  const allowed = ['slotIntervalMinutes', 'minNoticeMinutes', 'maxBookingDaysAhead'];
  if (Object.keys(body).length !== allowed.length || Object.keys(body).some(k => !allowed.includes(k)) || allowed.some(k => typeof body[k] !== 'number')) throw new Error('راجع إعدادات الحجز.');
  const error = bookingSettingsValidationError(body);
  if (error) throw new Error(error);
  return {slotIntervalMinutes:body.slotIntervalMinutes as number,minNoticeMinutes:body.minNoticeMinutes as number,maxBookingDaysAhead:body.maxBookingDaysAhead as number};
}
