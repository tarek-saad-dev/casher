import { describe, expect, it } from 'vitest';
import {
  buildOpsBoardPulseFingerprint,
  mergeOpsBoardPulse,
  shouldPlayNewBookingAlert,
} from '@/lib/operations/opsBoardPulse';

const empty = {
  maxBookingId: 0,
  bookingCount: 0,
  bookingUpdatedAt: '',
  maxQueueId: 0,
  queueCount: 0,
  calledQueueCount: 0,
  inServiceQueueCount: 0,
  availabilityVersion: 0,
};

describe('opsBoardPulse', () => {
  it('fingerprints booking and queue shifts', () => {
    const a = buildOpsBoardPulseFingerprint({ ...empty, maxBookingId: 10, bookingCount: 2 });
    const b = buildOpsBoardPulseFingerprint({ ...empty, maxBookingId: 11, bookingCount: 3 });
    expect(a).not.toBe(b);
  });

  it('merges branch pulses by max id and summed counts', () => {
    const merged = mergeOpsBoardPulse([
      { ...empty, maxBookingId: 8, bookingCount: 1, availabilityVersion: 2 },
      { ...empty, maxBookingId: 21, bookingCount: 4, availabilityVersion: 1 },
    ]);
    expect(merged.maxBookingId).toBe(21);
    expect(merged.bookingCount).toBe(5);
    expect(merged.availabilityVersion).toBe(2);
  });

  it('does not chime on the first sample', () => {
    expect(shouldPlayNewBookingAlert(null, 40)).toBe(false);
    expect(shouldPlayNewBookingAlert(0, 40)).toBe(false);
  });

  it('chimes when a newer booking id appears', () => {
    expect(shouldPlayNewBookingAlert(40, 41)).toBe(true);
    expect(shouldPlayNewBookingAlert(41, 41)).toBe(false);
  });
});
