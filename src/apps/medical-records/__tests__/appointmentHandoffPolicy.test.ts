import { describe, expect, it } from 'vitest';
import {
  isClinicArrivalAllowed, isClinicCalendarDate, isClinicStartAllowed, parseClinicBookingId,
} from '../application/appointmentHandoffPolicy';

describe('clinic appointment handoff policy', () => {
  it.each(['1', '32000', '2147483647'])('accepts canonical positive booking ID %s', id => {
    expect(parseClinicBookingId(id)).toBe(Number(id));
  });
  it.each(['0', '-1', '1.2', '01', ' 4', '4 ', '2147483648', 'x', '1e3', ''])('rejects invalid booking ID %s', id => {
    expect(parseClinicBookingId(id)).toBeNull();
  });
  it('only accepts real YYYY-MM-DD calendar days', () => {
    expect(isClinicCalendarDate('2026-10-26')).toBe(true);
    expect(isClinicCalendarDate('2026-02-29')).toBe(false);
    expect(isClinicCalendarDate('2024-02-29')).toBe(true);
    expect(isClinicCalendarDate('2026-13-01')).toBe(false);
    expect(isClinicCalendarDate('10/26/2026')).toBe(false);
  });
  it.each(['pending', 'confirmed'])('permits check-in from %s', status => {
    expect(isClinicArrivalAllowed(status)).toBe(true);
    expect(isClinicStartAllowed(status)).toBe(false);
  });
  it.each(['arrived', 'queued'])('permits starting only after check-in (%s)', status => {
    expect(isClinicStartAllowed(status)).toBe(true);
    expect(isClinicArrivalAllowed(status)).toBe(false);
  });
  it.each(['cancelled', 'no_show', 'rescheduled', 'completed', 'in_service', 'canceled'])('blocks stale or terminal booking state %s', status => {
    expect(isClinicArrivalAllowed(status)).toBe(false);
    expect(isClinicStartAllowed(status)).toBe(false);
  });
});
