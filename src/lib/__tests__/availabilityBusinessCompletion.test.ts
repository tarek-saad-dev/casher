import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildTransferTravelBuffers,
  intervalOverlapsTravelBuffer,
  TRANSFER_TRAVEL_BUFFER_MINUTES,
} from '@/lib/availability/transferTravelBuffer';
import { buildEmptySlotsUx } from '@/lib/availability/emptySlotsUx';
import {
  logBookingAvailabilityMetric,
  resetBookingAvailabilityMetricCountersForTests,
  getBookingAvailabilityMetricCounters,
} from '@/lib/availability/bookingAvailabilityMetrics';
import { windowWithinBranchHours } from '@/lib/availability/branchExceptionalHoursPure';
import { AVAILABILITY_REASON_CODES } from '@/lib/availability/reasonCodes';

describe('Phase A — booking availability metrics', () => {
  beforeEach(() => resetBookingAvailabilityMetricCountersForTests());

  it('counts structured events without PII fields', () => {
    logBookingAvailabilityMetric({
      event: 'booking_create_failure',
      reasonCode: 'HOLD_CONFLICT',
      branchId: 1,
      empId: 12,
      businessDate: '2026-08-17',
    });
    const c = getBookingAvailabilityMetricCounters();
    expect(c['booking_create_failure:HOLD_CONFLICT']).toBe(1);
  });
});

describe('Phase F — transfer travel buffer', () => {
  it('builds 60-minute buffers around transfer moment', () => {
    const mid = Date.parse('2026-08-17T15:00:00.000Z');
    const buffers = buildTransferTravelBuffers({
      transferAtMs: mid,
      fromBranchId: 1,
      toBranchId: 3,
    });
    expect(buffers).toHaveLength(2);
    expect(TRANSFER_TRAVEL_BUFFER_MINUTES).toBe(60);
    expect(buffers[0].endMs - buffers[0].startMs).toBe(60 * 60_000);
    expect(
      intervalOverlapsTravelBuffer(mid - 30 * 60_000, mid - 10 * 60_000, buffers),
    ).not.toBeNull();
    expect(
      intervalOverlapsTravelBuffer(mid + 90 * 60_000, mid + 120 * 60_000, buffers),
    ).toBeNull();
  });
});

describe('Phase L — empty slots UX', () => {
  it('returns Arabic message and recovery for known codes', () => {
    const ux = buildEmptySlotsUx('HOLD_CONFLICT');
    expect(ux.reasonCode).toBe('HOLD_CONFLICT');
    expect(ux.messageAr.length).toBeGreaterThan(3);
    expect(ux.recoverySuggestionAr.length).toBeGreaterThan(3);
  });

  it('includes new reason codes', () => {
    expect(AVAILABILITY_REASON_CODES).toContain('HOLD_CONFLICT');
    expect(AVAILABILITY_REASON_CODES).toContain('FREELANCER_HOURS_NOT_CONFIGURED');
    expect(AVAILABILITY_REASON_CODES).toContain('TRAVEL_BUFFER');
  });
});

describe('Phase E — branch exceptional hours containment', () => {
  it('rejects window outside branch hours', () => {
    const r = windowWithinBranchHours({
      windowStart: '08:00',
      windowEnd: '10:00',
      windowEndDayOffset: 0,
      branchOpen: '11:00',
      branchClose: '01:30',
      branchCloseDayOffset: 1,
      exceptional: null,
    });
    expect(r.ok).toBe(false);
    expect(r.reasonCode).toBe('OUTSIDE_BRANCH_HOURS');
  });

  it('accepts window inside exceptional open hours', () => {
    const r = windowWithinBranchHours({
      windowStart: '09:00',
      windowEnd: '12:00',
      windowEndDayOffset: 0,
      branchOpen: '11:00',
      branchClose: '22:00',
      branchCloseDayOffset: 0,
      exceptional: {
        isClosed: false,
        openTime: '09:00',
        endTime: '18:00',
        endDayOffset: 0,
      },
    });
    expect(r.ok).toBe(true);
  });
});
