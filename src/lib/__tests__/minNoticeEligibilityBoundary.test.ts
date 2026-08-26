/**
 * MinNotice boundary parity — availability start filtering + plan policy share one rule.
 * Frozen absolute times (Africa/Cairo).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  isMinNoticeNotMet,
  isMinNoticeNotMetMs,
  isSlotStartEligibleUnderMinNotice,
  minNoticeThresholdMs,
} from '@/lib/booking/domain/minNoticeEligibility';
import { BookingPolicy } from '@/lib/booking/domain/BookingPolicy';
import { createBookingInterval } from '@/lib/booking/domain/BookingInterval';
import { generateStartsFromFree } from '@/lib/booking/v2Frontend/generateStartsFromFreeRanges';
import {
  filterStartMinsByMinNotice,
  firstEligibleSlotOnGrid,
} from '@/lib/booking/v2Frontend/minNoticeSlotGrid';
import { startMinToV2Slot } from '@/lib/booking/v2Frontend/v2SlotStart';
import { evaluateBookingSlotAt } from '@/lib/bookingAvailabilityEngine';

const TZ = 'Africa/Cairo';
const BUSINESS_DATE = '2026-08-26';

/** Build epoch ms for a Cairo wall clock on BUSINESS_DATE. */
function cairoMs(hhmmss: string): number {
  // hhmmss: "21:15:08.305" or "21:15:00.000"
  const [hms, frac = '0'] = hhmmss.split('.');
  const [hh, mm, ss = '0'] = hms!.split(':');
  const time = `${hh!.padStart(2, '0')}:${mm!.padStart(2, '0')}`;
  const base = startMinToV2Slot(
    Number(hh) * 60 + Number(mm),
    BUSINESS_DATE,
    TZ,
  ).startAtMs;
  const extraMs =
    Number(ss) * 1000 + Number((frac + '000').slice(0, 3));
  return base + extraMs;
}

const GLEEM_NOTICE = 15;
const CAMP_NOTICE = 30; // representative branch policy (not hardcoded in production paths)

describe('minNoticeEligibility domain', () => {
  it('21:15:00.000 + 15m → threshold 21:30:00.000 → 21:30 valid', () => {
    const nowMs = cairoMs('21:15:00.000');
    const threshold = minNoticeThresholdMs(nowMs, GLEEM_NOTICE);
    expect(threshold).toBe(cairoMs('21:30:00.000'));

    const slot2130 = cairoMs('21:30:00.000');
    expect(
      isSlotStartEligibleUnderMinNotice({
        startAtMs: slot2130,
        nowMs,
        minNoticeMinutes: GLEEM_NOTICE,
      }),
    ).toBe(true);
    expect(
      isMinNoticeNotMet({
        startAtMs: slot2130,
        nowMs,
        minNoticeMinutes: GLEEM_NOTICE,
      }),
    ).toBe(false);
  });

  it('21:15:01.000 + 15m → 21:30 invalid, 21:45 first valid', () => {
    const nowMs = cairoMs('21:15:01.000');
    const threshold = minNoticeThresholdMs(nowMs, GLEEM_NOTICE);
    expect(threshold).toBe(cairoMs('21:30:01.000'));

    expect(
      isSlotStartEligibleUnderMinNotice({
        startAtMs: cairoMs('21:30:00.000'),
        nowMs,
        minNoticeMinutes: GLEEM_NOTICE,
      }),
    ).toBe(false);

    const first = firstEligibleSlotOnGrid({
      nowMs,
      minNoticeMinutes: GLEEM_NOTICE,
      businessDate: BUSINESS_DATE,
      slotIntervalMinutes: 15,
      timeZone: TZ,
    });
    expect(first?.time).toBe('21:45');
    expect(first?.dayOffset).toBe(0);
  });

  it('21:15:08.305 + 15m → first valid 21:45 (confirmed production case)', () => {
    const nowMs = cairoMs('21:15:08.305');
    expect(minNoticeThresholdMs(nowMs, GLEEM_NOTICE)).toBe(
      cairoMs('21:30:08.305'),
    );

    expect(
      isSlotStartEligibleUnderMinNotice({
        startAtMs: cairoMs('21:30:00.000'),
        nowMs,
        minNoticeMinutes: GLEEM_NOTICE,
      }),
    ).toBe(false);

    const first = firstEligibleSlotOnGrid({
      nowMs,
      minNoticeMinutes: GLEEM_NOTICE,
      businessDate: BUSINESS_DATE,
      slotIntervalMinutes: 15,
      timeZone: TZ,
    });
    expect(first?.time).toBe('21:45');
  });

  it('CAMP_CAESAR-style 30m policy uses same helper (not hardcoded branch)', () => {
    const nowMs = cairoMs('21:15:08.305');
    expect(
      isSlotStartEligibleUnderMinNotice({
        startAtMs: cairoMs('21:45:00.000'),
        nowMs,
        minNoticeMinutes: CAMP_NOTICE,
      }),
    ).toBe(false);

    const first = firstEligibleSlotOnGrid({
      nowMs,
      minNoticeMinutes: CAMP_NOTICE,
      businessDate: BUSINESS_DATE,
      slotIntervalMinutes: 15,
      timeZone: TZ,
    });
    expect(first?.time).toBe('22:00');
  });
});

describe('availability + plan share the same MinNotice rule', () => {
  const nowMs = cairoMs('21:15:08.305');
  const freeRanges = [{ startMin: 10 * 60, endMin: 23 * 60 }];

  it('generateStartsFromFree drops 21:30 and keeps 21:45', () => {
    const { starts } = generateStartsFromFree({
      freeRanges,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      businessDate: BUSINESS_DATE,
      nowMs,
      minNoticeMinutes: GLEEM_NOTICE,
    });
    const times = starts.map((s) => s.time);
    expect(times).not.toContain('21:30');
    expect(times[0]).toBe('21:45');
  });

  it('BookingPolicy.evaluateMinNotice agrees with generateStartsFromFree', () => {
    const deny2130 = BookingPolicy.evaluateMinNotice({
      interval: createBookingInterval({
        businessDate: BUSINESS_DATE,
        startAtMs: cairoMs('21:30:00.000'),
        endAtMs: cairoMs('22:00:00.000'),
        timeZone: TZ,
      }),
      nowMs,
      minNoticeMinutes: GLEEM_NOTICE,
    });
    expect(deny2130?.code).toBe('MIN_NOTICE_NOT_MET');

    const ok2145 = BookingPolicy.evaluateMinNotice({
      interval: createBookingInterval({
        businessDate: BUSINESS_DATE,
        startAtMs: cairoMs('21:45:00.000'),
        endAtMs: cairoMs('22:15:00.000'),
        timeZone: TZ,
      }),
      nowMs,
      minNoticeMinutes: GLEEM_NOTICE,
    });
    expect(ok2145).toBeNull();
  });

  it('evaluateBookingSlotAt (engine / plan path) agrees', () => {
    const r2130 = evaluateBookingSlotAt(cairoMs('21:30:00.000'), 30, [], {
      nowMs,
      minNoticeMs: GLEEM_NOTICE * 60_000,
    });
    expect(r2130.available).toBe(false);
    expect(r2130.reasonCode).toBe('minimum_notice');

    const r2145 = evaluateBookingSlotAt(cairoMs('21:45:00.000'), 30, [], {
      nowMs,
      minNoticeMs: GLEEM_NOTICE * 60_000,
    });
    expect(r2145.available).toBe(true);
  });

  it('isMinNoticeNotMetMs matches minutes form', () => {
    expect(
      isMinNoticeNotMetMs({
        startAtMs: cairoMs('21:30:00.000'),
        nowMs,
        minNoticeMs: GLEEM_NOTICE * 60_000,
      }),
    ).toBe(true);
    expect(
      isMinNoticeNotMet({
        startAtMs: cairoMs('21:30:00.000'),
        nowMs,
        minNoticeMinutes: GLEEM_NOTICE,
      }),
    ).toBe(true);
  });

  it('nearest chooses first actually valid slot on the grid', () => {
    const startMins = [21 * 60 + 15, 21 * 60 + 30, 21 * 60 + 45, 22 * 60];
    const filtered = filterStartMinsByMinNotice({
      startMins,
      businessDate: BUSINESS_DATE,
      nowMs,
      minNoticeMinutes: GLEEM_NOTICE,
      timeZone: TZ,
    });
    expect(filtered[0]).toBe(21 * 60 + 45);
    expect(
      firstEligibleSlotOnGrid({
        nowMs,
        minNoticeMinutes: GLEEM_NOTICE,
        businessDate: BUSINESS_DATE,
        slotIntervalMinutes: 15,
        timeZone: TZ,
      })?.startMin,
    ).toBe(filtered[0]);
  });
});

describe('overnight / timezone MinNotice unchanged', () => {
  it('keeps overnight startMin >= 1440 on next wall day with same BusinessDate', () => {
    const nowMs = cairoMs('23:50:08.305');
    const first = firstEligibleSlotOnGrid({
      nowMs,
      minNoticeMinutes: GLEEM_NOTICE,
      businessDate: BUSINESS_DATE,
      slotIntervalMinutes: 15,
      timeZone: TZ,
    });
    // threshold ~00:05:08 next calendar day → first grid 00:15 dayOffset 1
    expect(first?.dayOffset).toBe(1);
    expect(first?.time).toBe('00:15');
    expect(first!.startMin).toBeGreaterThanOrEqual(1440);
  });

  it('exact midnight threshold on overnight still allows exact grid', () => {
    const nowMs = cairoMs('23:45:00.000');
    const first = firstEligibleSlotOnGrid({
      nowMs,
      minNoticeMinutes: GLEEM_NOTICE,
      businessDate: BUSINESS_DATE,
      slotIntervalMinutes: 15,
      timeZone: TZ,
    });
    expect(first?.time).toBe('00:00');
    expect(first?.dayOffset).toBe(1);
  });
});
