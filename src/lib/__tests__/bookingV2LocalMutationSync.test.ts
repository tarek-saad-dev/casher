/**
 * Booking V2 Phase O2.5 — local availability mutation sync regressions.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import { salonWallToEpochMs } from '@/lib/booking/v2Frontend/v2SlotStart';
import type { V2PublicAvailabilityDayDto } from '@/lib/booking/v2Frontend/publicSafeDtos';
import {
  applyBookingCreated,
  applyBookingCancelled,
  applyBookingRescheduled,
  clearTargetedRevalidationInflight,
  getBookingV2StoreSnapshot,
  matrixScopeKey,
  notifyBookingV2CreateSuccess,
  notifyBookingV2SlotConflict,
  prefetchBookingV2Availability,
  resetBookingV2StoreForTests,
  setBookingV2Selection,
  commitBookingV2StoreUpdate,
  recomputeGeneratedStartsForSnapshot,
  revisionKey,
  type MatrixCacheEntry,
  type MatrixScope,
} from '@/lib/operations/bookingV2';
import { clearAvailabilityInflight } from '@/lib/operations/bookingV2/availabilityClient';
import { clearBootstrapClientCache } from '@/lib/operations/bookingV2/bootstrapClient';

const BUSINESS_DATE = '2026-08-20';
const KAREEM_EMP_ID = 7;
const ZEYAD_EMP_ID = 12;

function dayCell(partial: Partial<V2PublicAvailabilityDayDto> & {
  employeeId: number;
  branchCode: string;
  businessDate: string;
}): V2PublicAvailabilityDayDto {
  const freeRanges = partial.freeRanges ?? [{ startMin: 12 * 60, endMin: 14 * 60 }];
  const windowStart = salonWallToEpochMs(partial.businessDate, '00:00');
  return {
    employeeId: partial.employeeId,
    branchId: partial.branchId ?? (partial.branchCode === 'CAMP_CAESAR' ? 2 : 1),
    branchCode: partial.branchCode,
    businessDate: partial.businessDate,
    availabilityRevision: partial.availabilityRevision ?? 'rev-1',
    freeRanges,
    freeMaskB64: AvailabilityBitmap.fromFreeRanges(freeRanges).toBase64(),
    timezone: 'Africa/Cairo',
    businessDayStartAtMs: windowStart,
    timelineEndAtMs: windowStart + 48 * 60 * 60_000,
    hasOvernightFree: true,
    isAvailable: true,
  };
}

function buildRevisions(days: V2PublicAvailabilityDayDto[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of days) {
    out[revisionKey(d.employeeId, d.branchCode, d.businessDate)] = d.availabilityRevision;
  }
  return out;
}

function injectMatrix(scope: MatrixScope, days: V2PublicAvailabilityDayDto[]): void {
  const key = matrixScopeKey(scope);
  const entry: MatrixCacheEntry = {
    key,
    scope,
    matrix: {
      ok: true,
      contract: 'booking-v2-frontend-read-v1',
      generatedAt: new Date().toISOString(),
      timezone: 'Africa/Cairo',
      slotIntervalMinutes: 15,
      fromBusinessDate: scope.fromBusinessDate,
      toBusinessDate: scope.toBusinessDate,
      durationMinutes: null,
      days,
    },
    fetchedAt: Date.now(),
    revisions: buildRevisions(days),
  };

  commitBookingV2StoreUpdate((prev) => {
    const merged = {
      ...prev,
      bootstrap: prev.bootstrap ?? {
        ok: true as const,
        contract: 'booking-v2-frontend-read-v1' as const,
        capability: {
          version: 'booking-v2-frontend-read-v1' as const,
          supportsMatrix: true as const,
          supportsLocalSlotGeneration: true as const,
          overnightTimelineHours: 48 as const,
          availabilityQuantumMinutes: 5 as const,
        },
        revision: 'test',
        generatedAt: new Date().toISOString(),
        timezone: 'Africa/Cairo',
        branches: [],
        employees: [
          {
            employeeId: KAREEM_EMP_ID,
            nameAr: 'كريم',
            nameEn: 'Kareem',
            name: 'كريم',
            imageUrl: null,
            photoUrl: null,
            shortBio: null,
            displaySortOrder: 1,
            serviceIds: [1],
            branchCodes: ['GLEEM'],
          },
          {
            employeeId: ZEYAD_EMP_ID,
            nameAr: 'زياد',
            nameEn: 'Zeyad',
            name: 'زياد',
            imageUrl: null,
            photoUrl: null,
            shortBio: null,
            displaySortOrder: 2,
            serviceIds: [1],
            branchCodes: ['GLEEM', 'CAMP_CAESAR'],
          },
        ],
        employeeBranchMappings: [
          { employeeId: KAREEM_EMP_ID, branchId: 1, branchCode: 'GLEEM' },
          { employeeId: ZEYAD_EMP_ID, branchId: 1, branchCode: 'GLEEM' },
          { employeeId: ZEYAD_EMP_ID, branchId: 2, branchCode: 'CAMP_CAESAR' },
        ],
        servicesByBranch: {},
        settingsByBranch: {
          GLEEM: {
            branchId: 1,
            branchCode: 'GLEEM',
            minNoticeMinutes: 0,
            maxBookingDaysAhead: 14,
            slotIntervalMinutes: 15,
            allowSpecificBarber: true,
            allowNearestBarber: true,
            defaultMode: 'specific',
            timezone: 'Africa/Cairo',
            currency: 'EGP',
            bookingEnabled: true,
          },
          CAMP_CAESAR: {
            branchId: 2,
            branchCode: 'CAMP_CAESAR',
            minNoticeMinutes: 0,
            maxBookingDaysAhead: 14,
            slotIntervalMinutes: 15,
            allowSpecificBarber: true,
            allowNearestBarber: true,
            defaultMode: 'specific',
            timezone: 'Africa/Cairo',
            currency: 'EGP',
            bookingEnabled: true,
          },
        },
        media: [],
      },
      matricesByKey: { ...prev.matricesByKey, [key]: entry },
      activeMatrixKey: key,
      availabilityStatus: 'ready' as const,
    };
    return {
      ...merged,
      generatedStarts: recomputeGeneratedStartsForSnapshot(merged),
    };
  });
}

function hasStartAt1230(): boolean {
  const snap = getBookingV2StoreSnapshot();
  return snap.generatedStarts.some(
    (s) => s.employeeId === KAREEM_EMP_ID && s.time === '12:30' && s.businessDate === BUSINESS_DATE,
  );
}

function hasStartAt1200(): boolean {
  const snap = getBookingV2StoreSnapshot();
  return snap.generatedStarts.some(
    (s) => s.employeeId === KAREEM_EMP_ID && s.time === '12:00' && s.businessDate === BUSINESS_DATE,
  );
}

function hasStartAt1800(branchCode: string): boolean {
  const snap = getBookingV2StoreSnapshot();
  return snap.generatedStarts.some(
    (s) =>
      s.employeeId === ZEYAD_EMP_ID
      && s.time === '18:00'
      && s.branchCode === branchCode
      && s.businessDate === BUSINESS_DATE,
  );
}

function hasStartAt1600(): boolean {
  const snap = getBookingV2StoreSnapshot();
  return snap.generatedStarts.some(
    (s) => s.employeeId === KAREEM_EMP_ID && s.time === '16:00' && s.businessDate === BUSINESS_DATE,
  );
}

function matrixHasFreeAt(args: {
  employeeId: number;
  branchCode: string;
  time: string;
}): boolean {
  const snap = getBookingV2StoreSnapshot();
  const entry = snap.activeMatrixKey ? snap.matricesByKey[snap.activeMatrixKey] : null;
  if (!entry) return false;
  const day = entry.matrix.days.find(
    (d) =>
      d.employeeId === args.employeeId
      && d.branchCode === args.branchCode
      && d.businessDate === BUSINESS_DATE,
  );
  if (!day) return false;
  const [h, m] = args.time.split(':').map(Number);
  const startMin = h! * 60 + m!;
  const endMin = startMin + 30;
  return day.freeRanges.some((r) => r.startMin <= startMin && r.endMin >= endMin);
}

const root = process.cwd();

describe('BOOKING V2 LOCAL MUTATION SYNC VERIFIED', () => {
  beforeEach(() => {
    resetBookingV2StoreForTests();
    clearBootstrapClientCache();
    clearAvailabilityInflight();
    clearTargetedRevalidationInflight();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetBookingV2StoreForTests();
    clearTargetedRevalidationInflight();
    vi.restoreAllMocks();
  });

  it('CREATE — slot disappears immediately without manual matrix refresh', () => {
    const scope: MatrixScope = {
      kind: 'employee',
      employeeId: KAREEM_EMP_ID,
      branchCodes: ['GLEEM'],
      fromBusinessDate: BUSINESS_DATE,
      toBusinessDate: '2026-08-30',
    };
    injectMatrix(scope, [
      dayCell({ employeeId: KAREEM_EMP_ID, branchCode: 'GLEEM', businessDate: BUSINESS_DATE }),
    ]);
    setBookingV2Selection({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      serviceIds: [1],
      mode: 'specific',
    });

    expect(hasStartAt1230()).toBe(true);

    const startAtMs = salonWallToEpochMs(BUSINESS_DATE, '12:30');
    const endAtMs = startAtMs + 30 * 60_000;

    applyBookingCreated({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
      branchCode: 'GLEEM',
      startAtMs,
      endAtMs,
    });

    expect(hasStartAt1230()).toBe(false);
  });

  it('SECOND BOOKING OPEN — previously booked slot absent from cached store', () => {
    const scope: MatrixScope = {
      kind: 'employee',
      employeeId: KAREEM_EMP_ID,
      branchCodes: ['GLEEM'],
      fromBusinessDate: BUSINESS_DATE,
      toBusinessDate: '2026-08-30',
    };
    injectMatrix(scope, [
      dayCell({ employeeId: KAREEM_EMP_ID, branchCode: 'GLEEM', businessDate: BUSINESS_DATE }),
    ]);
    setBookingV2Selection({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      mode: 'specific',
    });

    notifyBookingV2CreateSuccess({
      createResponse: {
        ok: true,
        booking: {
          id: 201,
          date: BUSINESS_DATE,
          startDateTime: new Date(salonWallToEpochMs(BUSINESS_DATE, '12:30')).toISOString(),
          endDateTime: new Date(salonWallToEpochMs(BUSINESS_DATE, '13:00')).toISOString(),
          barber: { empId: KAREEM_EMP_ID },
          branch: { branchCode: 'GLEEM' },
        },
      },
    });

    const snap = getBookingV2StoreSnapshot();
    expect(snap.generatedStarts.some((s) => s.time === '12:30')).toBe(false);
  });

  it('CROSS-BRANCH GLOBAL EMPLOYEE — same absolute interval removed from all branch caches', () => {
    const free18 = [{ startMin: 17 * 60, endMin: 20 * 60 }];
    const scope: MatrixScope = {
      kind: 'employee',
      employeeId: ZEYAD_EMP_ID,
      branchCodes: ['GLEEM', 'CAMP_CAESAR'],
      fromBusinessDate: BUSINESS_DATE,
      toBusinessDate: '2026-08-30',
    };
    injectMatrix(scope, [
      dayCell({
        employeeId: ZEYAD_EMP_ID,
        branchCode: 'GLEEM',
        businessDate: BUSINESS_DATE,
        freeRanges: free18,
      }),
      dayCell({
        employeeId: ZEYAD_EMP_ID,
        branchCode: 'CAMP_CAESAR',
        businessDate: BUSINESS_DATE,
        freeRanges: free18,
        branchId: 2,
      }),
    ]);
    setBookingV2Selection({
      employeeId: ZEYAD_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      mode: 'specific',
    });

    expect(hasStartAt1800('GLEEM')).toBe(true);
    expect(
      matrixHasFreeAt({ employeeId: ZEYAD_EMP_ID, branchCode: 'CAMP_CAESAR', time: '18:00' }),
    ).toBe(true);

    const startAtMs = salonWallToEpochMs(BUSINESS_DATE, '18:00');
    applyBookingCreated({
      employeeId: ZEYAD_EMP_ID,
      businessDate: BUSINESS_DATE,
      branchCode: 'GLEEM',
      startAtMs,
      endAtMs: startAtMs + 30 * 60_000,
    });

    expect(hasStartAt1800('GLEEM')).toBe(false);
    expect(
      matrixHasFreeAt({ employeeId: ZEYAD_EMP_ID, branchCode: 'CAMP_CAESAR', time: '18:00' }),
    ).toBe(false);
  });

  it('CANCEL — no blind free restore; authoritative revalidate restores slot', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v2/availability')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          fromBusinessDate?: string;
          toBusinessDate?: string;
        };
        expect(body.fromBusinessDate).toBe(BUSINESS_DATE);
        expect(body.toBusinessDate).toBe(BUSINESS_DATE);
        const restored = dayCell({
          employeeId: KAREEM_EMP_ID,
          branchCode: 'GLEEM',
          businessDate: BUSINESS_DATE,
          availabilityRevision: 'rev-after-cancel',
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            contract: 'booking-v2-frontend-read-v1',
            generatedAt: new Date().toISOString(),
            timezone: 'Africa/Cairo',
            slotIntervalMinutes: 15,
            fromBusinessDate: BUSINESS_DATE,
            toBusinessDate: BUSINESS_DATE,
            durationMinutes: null,
            days: [restored],
          }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const occupied = [{ startMin: 12 * 60, endMin: 12 * 60 + 30 }, { startMin: 13 * 60, endMin: 14 * 60 }];
    const scope: MatrixScope = {
      kind: 'employee',
      employeeId: KAREEM_EMP_ID,
      branchCodes: ['GLEEM'],
      fromBusinessDate: BUSINESS_DATE,
      toBusinessDate: '2026-08-30',
    };
    injectMatrix(scope, [
      dayCell({
        employeeId: KAREEM_EMP_ID,
        branchCode: 'GLEEM',
        businessDate: BUSINESS_DATE,
        freeRanges: occupied,
      }),
    ]);
    setBookingV2Selection({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      mode: 'specific',
    });

    expect(hasStartAt1230()).toBe(false);

    applyBookingCancelled({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(hasStartAt1230()).toBe(true);
    });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/v2/availability'))).toBe(true);
  });

  it('RESCHEDULE — new interval removed immediately; old only after revalidate', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v2/availability')) {
        const oldFree = [{ startMin: 18 * 60, endMin: 20 * 60 }];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            contract: 'booking-v2-frontend-read-v1',
            generatedAt: new Date().toISOString(),
            timezone: 'Africa/Cairo',
            slotIntervalMinutes: 15,
            fromBusinessDate: BUSINESS_DATE,
            toBusinessDate: BUSINESS_DATE,
            durationMinutes: null,
            days: [
              dayCell({
                employeeId: ZEYAD_EMP_ID,
                branchCode: 'GLEEM',
                businessDate: BUSINESS_DATE,
                freeRanges: oldFree,
                availabilityRevision: 'rev-after-reschedule',
              }),
            ],
          }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const bookedAt18 = [{ startMin: 19 * 60, endMin: 20 * 60 }];
    injectMatrix(
      {
        kind: 'employee',
        employeeId: ZEYAD_EMP_ID,
        branchCodes: ['GLEEM'],
        fromBusinessDate: BUSINESS_DATE,
        toBusinessDate: '2026-08-30',
      },
      [
        dayCell({
          employeeId: ZEYAD_EMP_ID,
          branchCode: 'GLEEM',
          businessDate: BUSINESS_DATE,
          freeRanges: bookedAt18,
        }),
      ],
    );
    setBookingV2Selection({
      employeeId: ZEYAD_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      mode: 'specific',
    });

    expect(hasStartAt1800('GLEEM')).toBe(false);
    expect(getBookingV2StoreSnapshot().generatedStarts.some((s) => s.time === '19:00')).toBe(
      true,
    );

    const oldStart = salonWallToEpochMs(BUSINESS_DATE, '18:00');
    const oldEnd = oldStart + 30 * 60_000;
    const newStart = salonWallToEpochMs(BUSINESS_DATE, '19:00');
    const newEnd = newStart + 30 * 60_000;

    applyBookingRescheduled({
      oldInterval: {
        employeeId: ZEYAD_EMP_ID,
        businessDate: BUSINESS_DATE,
        startAtMs: oldStart,
        endAtMs: oldEnd,
      },
      newInterval: {
        employeeId: ZEYAD_EMP_ID,
        businessDate: BUSINESS_DATE,
        startAtMs: newStart,
        endAtMs: newEnd,
      },
    });

    const snapImmediate = getBookingV2StoreSnapshot();
    expect(snapImmediate.generatedStarts.some((s) => s.time === '19:00')).toBe(false);
    expect(snapImmediate.generatedStarts.some((s) => s.time === '18:00')).toBe(false);

    await vi.waitFor(() => {
      expect(hasStartAt1800('GLEEM')).toBe(true);
    });
  });

  it('FAILED WRITE — no optimistic mutation when create notify skipped', () => {
    injectMatrix(
      {
        kind: 'employee',
        employeeId: KAREEM_EMP_ID,
        branchCodes: ['GLEEM'],
        fromBusinessDate: BUSINESS_DATE,
        toBusinessDate: '2026-08-30',
      },
      [dayCell({ employeeId: KAREEM_EMP_ID, branchCode: 'GLEEM', businessDate: BUSINESS_DATE })],
    );
    setBookingV2Selection({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      mode: 'specific',
    });

    expect(hasStartAt1230()).toBe(true);
    notifyBookingV2CreateSuccess({ createResponse: { ok: false } });
    expect(hasStartAt1230()).toBe(true);
  });

  it('SLOT_UNAVAILABLE — targeted 1-day revalidate (not full 14-day prefetch)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v2/availability')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          fromBusinessDate?: string;
          toBusinessDate?: string;
        };
        expect(body.fromBusinessDate).toBe(body.toBusinessDate);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            contract: 'booking-v2-frontend-read-v1',
            generatedAt: new Date().toISOString(),
            timezone: 'Africa/Cairo',
            slotIntervalMinutes: 15,
            fromBusinessDate: BUSINESS_DATE,
            toBusinessDate: BUSINESS_DATE,
            durationMinutes: null,
            days: [
              dayCell({
                employeeId: KAREEM_EMP_ID,
                branchCode: 'GLEEM',
                businessDate: BUSINESS_DATE,
                freeRanges: [{ startMin: 13 * 60, endMin: 14 * 60 }],
                availabilityRevision: 'rev-fresh',
              }),
            ],
          }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    injectMatrix(
      {
        kind: 'employee',
        employeeId: KAREEM_EMP_ID,
        branchCodes: ['GLEEM'],
        fromBusinessDate: BUSINESS_DATE,
        toBusinessDate: '2026-08-30',
      },
      [dayCell({ employeeId: KAREEM_EMP_ID, branchCode: 'GLEEM', businessDate: BUSINESS_DATE })],
    );
    setBookingV2Selection({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      mode: 'specific',
    });

    notifyBookingV2SlotConflict({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      expect(hasStartAt1230()).toBe(false);
    });
  });

  it('FULL 14-DAY REFETCH AFTER WRITE — create uses local patch only', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    injectMatrix(
      {
        kind: 'employee',
        employeeId: KAREEM_EMP_ID,
        branchCodes: ['GLEEM'],
        fromBusinessDate: BUSINESS_DATE,
        toBusinessDate: '2026-08-30',
      },
      [dayCell({ employeeId: KAREEM_EMP_ID, branchCode: 'GLEEM', businessDate: BUSINESS_DATE })],
    );

    applyBookingCreated({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
      startAtMs: salonWallToEpochMs(BUSINESS_DATE, '12:30'),
      endAtMs: salonWallToEpochMs(BUSINESS_DATE, '13:00'),
    });

    expect(hasStartAt1230()).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    const availabilityCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/v2/availability'),
    );
    for (const call of availabilityCalls) {
      const body = JSON.parse(String(call[1]?.body ?? '{}')) as {
        fromBusinessDate?: string;
        toBusinessDate?: string;
      };
      expect(body.fromBusinessDate).toBe(BUSINESS_DATE);
      expect(body.toBusinessDate).toBe(BUSINESS_DATE);
    }
    expect(
      availabilityCalls.some((c) => {
        const body = JSON.parse(String(c[1]?.body ?? '{}')) as {
          toBusinessDate?: string;
          fromBusinessDate?: string;
        };
        return body.fromBusinessDate !== body.toBusinessDate;
      }),
    ).toBe(false);
  });

  it('LEGACY AVAILABLE-SLOTS CALL — workspace wiring forbids waterfall', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/available-slots')) {
        throw new Error('FORBIDDEN legacy available-slots');
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, days: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      force: true,
    }).catch(() => {});

    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('/available-slots'))).toBe(
      true,
    );
  });

  it('CREATE then CANCEL — slot reappears without page refresh (modal restore regression)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v2/availability')) {
        const restored = dayCell({
          employeeId: KAREEM_EMP_ID,
          branchCode: 'GLEEM',
          businessDate: BUSINESS_DATE,
          availabilityRevision: 'rev-after-cancel',
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            contract: 'booking-v2-frontend-read-v1',
            generatedAt: new Date().toISOString(),
            timezone: 'Africa/Cairo',
            slotIntervalMinutes: 15,
            fromBusinessDate: BUSINESS_DATE,
            toBusinessDate: BUSINESS_DATE,
            durationMinutes: null,
            days: [restored],
          }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    injectMatrix(
      {
        kind: 'employee',
        employeeId: KAREEM_EMP_ID,
        branchCodes: ['GLEEM'],
        fromBusinessDate: BUSINESS_DATE,
        toBusinessDate: '2026-08-30',
      },
      [dayCell({ employeeId: KAREEM_EMP_ID, branchCode: 'GLEEM', businessDate: BUSINESS_DATE })],
    );
    setBookingV2Selection({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      mode: 'specific',
    });

    expect(hasStartAt1200()).toBe(true);

    applyBookingCreated({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
      startAtMs: salonWallToEpochMs(BUSINESS_DATE, '12:00'),
      endAtMs: salonWallToEpochMs(BUSINESS_DATE, '12:30'),
    });
    expect(hasStartAt1200()).toBe(false);

    applyBookingCancelled({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
    });

    await vi.waitFor(() => {
      expect(hasStartAt1200()).toBe(true);
    });
  });

  it('MERGE — same revision but different freeMask still replaces local optimistic patch', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/v2/availability')) {
        const restored = dayCell({
          employeeId: KAREEM_EMP_ID,
          branchCode: 'GLEEM',
          businessDate: BUSINESS_DATE,
          availabilityRevision: 'rev-stable',
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            contract: 'booking-v2-frontend-read-v1',
            generatedAt: new Date().toISOString(),
            timezone: 'Africa/Cairo',
            slotIntervalMinutes: 15,
            fromBusinessDate: BUSINESS_DATE,
            toBusinessDate: BUSINESS_DATE,
            durationMinutes: null,
            days: [restored],
          }),
        };
      }
      throw new Error('unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    const original = dayCell({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      availabilityRevision: 'rev-stable',
    });
    injectMatrix(
      {
        kind: 'employee',
        employeeId: KAREEM_EMP_ID,
        branchCodes: ['GLEEM'],
        fromBusinessDate: BUSINESS_DATE,
        toBusinessDate: '2026-08-30',
      },
      [original],
    );
    setBookingV2Selection({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      mode: 'specific',
    });

    applyBookingCreated({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
      startAtMs: salonWallToEpochMs(BUSINESS_DATE, '12:00'),
      endAtMs: salonWallToEpochMs(BUSINESS_DATE, '12:30'),
    });
    expect(hasStartAt1200()).toBe(false);

    applyBookingCancelled({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
    });

    await vi.waitFor(() => {
      expect(hasStartAt1200()).toBe(true);
    });
  });

  it('TARGETED 1-DAY CANCEL PATCHES ORIGINAL 14-DAY MATRIX CACHE', async () => {
    const fullScope: MatrixScope = {
      kind: 'employee',
      employeeId: KAREEM_EMP_ID,
      branchCodes: ['GLEEM'],
      fromBusinessDate: BUSINESS_DATE,
      toBusinessDate: '2026-08-31',
    };
    const fullKey = matrixScopeKey(fullScope);
    const restored = dayCell({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      availabilityRevision: 'rev-cancel-targeted',
      freeRanges: [{ startMin: 16 * 60, endMin: 18 * 60 }],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/v2/availability')) {
        throw new Error(`unexpected ${String(input)}`);
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        fromBusinessDate?: string;
        toBusinessDate?: string;
      };
      expect(body.fromBusinessDate).toBe(BUSINESS_DATE);
      expect(body.toBusinessDate).toBe(BUSINESS_DATE);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          contract: 'booking-v2-frontend-read-v1',
          generatedAt: new Date().toISOString(),
          timezone: 'Africa/Cairo',
          slotIntervalMinutes: 15,
          fromBusinessDate: BUSINESS_DATE,
          toBusinessDate: BUSINESS_DATE,
          durationMinutes: null,
          days: [restored],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    injectMatrix(fullScope, [
      dayCell({
        employeeId: KAREEM_EMP_ID,
        branchCode: 'GLEEM',
        businessDate: BUSINESS_DATE,
        freeRanges: [{ startMin: 16 * 60 + 30, endMin: 18 * 60 }],
        availabilityRevision: 'rev-before-cancel',
      }),
    ]);
    setBookingV2Selection({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      mode: 'specific',
    });

    expect(hasStartAt1600()).toBe(false);
    expect(matrixHasFreeAt({ employeeId: KAREEM_EMP_ID, branchCode: 'GLEEM', time: '16:00' })).toBe(false);

    await applyBookingCancelled({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
    });

    await vi.waitFor(() => {
      expect(hasStartAt1600()).toBe(true);
    });

    const snap = getBookingV2StoreSnapshot();
    expect(snap.matricesByKey[fullKey]).toBeTruthy();
    expect(
      snap.matricesByKey[fullKey]?.matrix.days.find(
        (d) =>
          d.employeeId === KAREEM_EMP_ID
          && d.branchCode === 'GLEEM'
          && d.businessDate === BUSINESS_DATE,
      )?.availabilityRevision,
    ).toBe('rev-cancel-targeted');
    expect(matrixHasFreeAt({ employeeId: KAREEM_EMP_ID, branchCode: 'GLEEM', time: '16:00' })).toBe(true);
  });

  it('OVERLAP SAFETY — cancel does not restore slot when authoritative day still occupied', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/v2/availability')) {
        const stillBusy = dayCell({
          employeeId: KAREEM_EMP_ID,
          branchCode: 'GLEEM',
          businessDate: BUSINESS_DATE,
          freeRanges: [{ startMin: 13 * 60, endMin: 14 * 60 }],
          availabilityRevision: 'rev-hold-blocks',
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            contract: 'booking-v2-frontend-read-v1',
            generatedAt: new Date().toISOString(),
            timezone: 'Africa/Cairo',
            slotIntervalMinutes: 15,
            fromBusinessDate: BUSINESS_DATE,
            toBusinessDate: BUSINESS_DATE,
            durationMinutes: null,
            days: [stillBusy],
          }),
        };
      }
      throw new Error('unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    injectMatrix(
      {
        kind: 'employee',
        employeeId: KAREEM_EMP_ID,
        branchCodes: ['GLEEM'],
        fromBusinessDate: BUSINESS_DATE,
        toBusinessDate: '2026-08-30',
      },
      [
        dayCell({
          employeeId: KAREEM_EMP_ID,
          branchCode: 'GLEEM',
          businessDate: BUSINESS_DATE,
          freeRanges: [{ startMin: 13 * 60, endMin: 14 * 60 }],
        }),
      ],
    );
    setBookingV2Selection({
      employeeId: KAREEM_EMP_ID,
      branchCode: 'GLEEM',
      businessDate: BUSINESS_DATE,
      durationMinutes: 30,
      mode: 'specific',
    });

    applyBookingCreated({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
      startAtMs: salonWallToEpochMs(BUSINESS_DATE, '12:00'),
      endAtMs: salonWallToEpochMs(BUSINESS_DATE, '12:30'),
    });
    applyBookingCancelled({
      employeeId: KAREEM_EMP_ID,
      businessDate: BUSINESS_DATE,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(hasStartAt1200()).toBe(false);
  });

  it('TIMELINE CANCEL WIRED — SchedulerBoard notifies Booking V2 store', () => {
    const board = readFileSync(
      join(root, 'src/components/operations/SchedulerBoard.tsx'),
      'utf8',
    );
    expect(board).toContain('notifyBookingV2CancelFromTimeline');
    expect(board).toContain("action: 'cancel'");
  });
});
