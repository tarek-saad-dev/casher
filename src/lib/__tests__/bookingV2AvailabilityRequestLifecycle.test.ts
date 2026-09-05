/**
 * Phase A — Booking V2 availability request lifecycle / eternal-loading regression.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import { getOperationalDate, shiftCalendarDate } from '@/lib/businessDate';
import {
  AVAILABILITY_FETCH_TIMEOUT_MESSAGE_AR,
  AVAILABILITY_FETCH_TIMEOUT_MS,
  getBookingV2StoreSnapshot,
  prefetchBookingV2Availability,
  prefetchBookingV2Bootstrap,
  resetBookingV2StoreForTests,
  setBookingV2Selection,
} from '@/lib/operations/bookingV2';
import { clearBootstrapClientCache } from '@/lib/operations/bookingV2/bootstrapClient';
import { clearAvailabilityInflight } from '@/lib/operations/bookingV2/availabilityClient';
import type { V2PublicAvailabilityDayDto } from '@/lib/booking/v2Frontend/publicSafeDtos';

const OPS_TODAY = getOperationalDate();
const OPS_TOMORROW = shiftCalendarDate(OPS_TODAY, 1);
const OPS_WINDOW_END = shiftCalendarDate(OPS_TODAY, 13);

function dayCell(partial: Partial<V2PublicAvailabilityDayDto> & {
  employeeId: number;
  branchCode: string;
  businessDate: string;
}): V2PublicAvailabilityDayDto {
  const freeRanges = partial.freeRanges ?? [{ startMin: 16 * 60, endMin: 26 * 60 }];
  return {
    employeeId: partial.employeeId,
    branchId: partial.branchId ?? 1,
    branchCode: partial.branchCode,
    businessDate: partial.businessDate,
    availabilityRevision: partial.availabilityRevision ?? 'rev-1',
    freeRanges,
    freeMaskB64: AvailabilityBitmap.fromFreeRanges(freeRanges).toBase64(),
    timezone: 'Africa/Cairo',
    businessDayStartAtMs: 0,
    timelineEndAtMs: 0,
    hasOvernightFree: true,
    isAvailable: true,
  };
}

const bootstrap = {
  ok: true as const,
  contract: 'booking-v2-frontend-read-v1' as const,
  capability: {
    version: 'booking-v2-frontend-read-v1' as const,
    supportsMatrix: true as const,
    supportsLocalSlotGeneration: true as const,
    overnightTimelineHours: 48 as const,
    availabilityQuantumMinutes: 5 as const,
  },
  revision: 'lifecycle-rev',
  generatedAt: new Date().toISOString(),
  timezone: 'Africa/Cairo',
  branches: [],
  employees: [
    {
      employeeId: 12,
      nameAr: 'زياد',
      nameEn: 'Zeyad',
      name: 'زياد',
      imageUrl: null,
      photoUrl: null,
      shortBio: null,
      displaySortOrder: 1,
      serviceIds: [1],
      branchCodes: ['GLEEM'],
    },
    {
      employeeId: 99,
      nameAr: 'محمود',
      nameEn: 'Mahmoud',
      name: 'محمود',
      imageUrl: null,
      photoUrl: null,
      shortBio: null,
      displaySortOrder: 2,
      serviceIds: [1],
      branchCodes: ['GLEEM'],
    },
  ],
  employeeBranchMappings: [
    { employeeId: 12, branchId: 1, branchCode: 'GLEEM' },
    { employeeId: 99, branchId: 1, branchCode: 'GLEEM' },
  ],
  servicesByBranch: {
    GLEEM: [
      {
        serviceId: 1,
        nameAr: 'قص',
        nameEn: 'Cut',
        name: 'قص',
        price: 100,
        durationMinutes: 30,
        imageUrl: null,
        photoUrl: null,
        categoryId: '1',
        categoryNameAr: '',
        categoryNameEn: '',
        sortOrder: 1,
        bookable: true as const,
      },
    ],
  },
  settingsByBranch: {
    GLEEM: {
      branchId: 1,
      branchCode: 'GLEEM',
      minNoticeMinutes: 0,
      maxBookingDaysAhead: 14,
      slotIntervalMinutes: 15,
      allowSpecificBarber: true,
      allowNearestBarber: true,
      defaultMode: 'specific' as const,
      timezone: 'Africa/Cairo',
      currency: 'EGP',
      bookingEnabled: true,
    },
  },
  media: [],
};

function matrixForEmp(employeeId: number, revision: string) {
  return {
    ok: true as const,
    contract: 'booking-v2-frontend-read-v1' as const,
    generatedAt: new Date().toISOString(),
    timezone: 'Africa/Cairo',
    slotIntervalMinutes: 15,
    fromBusinessDate: OPS_TODAY,
    toBusinessDate: OPS_WINDOW_END,
    durationMinutes: null,
    days: [
      dayCell({
        employeeId,
        branchCode: 'GLEEM',
        businessDate: OPS_TODAY,
        availabilityRevision: revision,
        // Full daytime window so evening test runs still yield starts.
        freeRanges: [{ startMin: 0, endMin: 26 * 60 }],
      }),
      dayCell({
        employeeId,
        branchCode: 'GLEEM',
        businessDate: OPS_TOMORROW,
        availabilityRevision: `${revision}-d1`,
        freeRanges: [{ startMin: 0, endMin: 26 * 60 }],
      }),
    ],
  };
}

type Gate = {
  signal?: AbortSignal;
  resolve: (matrix: ReturnType<typeof matrixForEmp>) => void;
  reject: (err: Error) => void;
};

function installGatedFetch() {
  const gates: Gate[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/v2/bootstrap')) {
      return {
        ok: true,
        status: 200,
        json: async () => bootstrap,
        headers: { get: (h: string) => (h.toLowerCase() === 'etag' ? 'W/"lifecycle"' : null) },
      };
    }
    if (url.includes('/v2/availability')) {
      const signal = init?.signal ?? undefined;
      return new Promise((resolve, reject) => {
        const fail = (err: Error) => reject(err);
        if (signal?.aborted) {
          const reason = signal.reason;
          if (reason instanceof Error) fail(reason);
          else fail(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          return;
        }
        const onAbort = () => {
          const reason = signal?.reason;
          if (reason instanceof Error) fail(reason);
          else fail(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        gates.push({
          signal,
          resolve: (matrix) => {
            signal?.removeEventListener('abort', onAbort);
            resolve({
              ok: true,
              status: 200,
              json: async () => matrix,
              headers: { get: () => null },
            });
          },
          reject: (err) => {
            signal?.removeEventListener('abort', onAbort);
            fail(err);
          },
        });
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, gates };
}

async function seedBootstrap() {
  const { fetchMock } = installGatedFetch();
  await prefetchBookingV2Bootstrap();
  fetchMock.mockClear();
  return installGatedFetch();
}

describe('Booking V2 availability request lifecycle', () => {
  beforeEach(() => {
    resetBookingV2StoreForTests();
    clearBootstrapClientCache();
    clearAvailabilityInflight();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetBookingV2StoreForTests();
    clearBootstrapClientCache();
    clearAvailabilityInflight();
  });

  it('Case A — timeout with no replacement leaves recoverable error (not eternal loading)', async () => {
    vi.useFakeTimers();
    const { gates } = await seedBootstrap();
    setBookingV2Selection({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      businessDate: OPS_TODAY,
      serviceIds: [1],
      durationMinutes: 30,
    });

    const pending = prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      force: true,
    });

    expect(getBookingV2StoreSnapshot().availabilityStatus).toBe('loading');
    expect(gates).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(AVAILABILITY_FETCH_TIMEOUT_MS);
    await pending;

    const snap = getBookingV2StoreSnapshot();
    expect(snap.availabilityStatus).toBe('error');
    expect(snap.availabilityError).toBe(AVAILABILITY_FETCH_TIMEOUT_MESSAGE_AR);
    expect(snap.availabilityLoadingKey).toBeNull();
  });

  it('Case B — A superseded by B; final state reflects B; A abort does not clear B', async () => {
    const { gates } = await seedBootstrap();
    setBookingV2Selection({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      businessDate: OPS_TODAY,
      serviceIds: [1],
      durationMinutes: 30,
    });

    const pA = prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      force: true,
    });
    expect(getBookingV2StoreSnapshot().availabilityStatus).toBe('loading');
    expect(gates).toHaveLength(1);

    setBookingV2Selection({ employeeId: 99 });
    const pB = prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 99,
      branchCode: 'GLEEM',
      force: true,
    });

    // Same or different key — B is authoritative and still loading.
    expect(getBookingV2StoreSnapshot().availabilityStatus).toBe('loading');
    expect(gates.length).toBeGreaterThanOrEqual(2);

    const gateB = gates[gates.length - 1]!;
    gateB.resolve(matrixForEmp(99, 'rev-B'));
    await pB;
    await pA;

    const snap = getBookingV2StoreSnapshot();
    expect(snap.availabilityStatus).toBe('ready');
    expect(snap.availabilityError).toBeNull();
    expect(snap.activeMatrixKey).toContain('emp:99');
    expect(snap.matricesByKey[snap.activeMatrixKey!]?.matrix.days[0]?.employeeId).toBe(99);
  });

  it('Case C — stale success from A must not replace B after B succeeded', async () => {
    const { gates } = await seedBootstrap();
    setBookingV2Selection({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      businessDate: OPS_TODAY,
      serviceIds: [1],
      durationMinutes: 30,
    });

    const pA = prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      force: true,
    });
    const gateA = gates[0]!;

    setBookingV2Selection({ employeeId: 99 });
    const pB = prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 99,
      branchCode: 'GLEEM',
      force: true,
    });
    const gateB = gates[gates.length - 1]!;

    gateB.resolve(matrixForEmp(99, 'rev-B'));
    await pB;
    expect(getBookingV2StoreSnapshot().activeMatrixKey).toContain('emp:99');

    // Late resolve of A (if not aborted) or aborted path — must not overwrite B.
    if (!gateA.signal?.aborted) {
      gateA.resolve(matrixForEmp(12, 'rev-A-stale'));
    }
    await pA;

    const snap = getBookingV2StoreSnapshot();
    expect(snap.availabilityStatus).toBe('ready');
    expect(snap.activeMatrixKey).toContain('emp:99');
    expect(snap.matricesByKey[snap.activeMatrixKey!]?.matrix.days[0]?.availabilityRevision).toBe('rev-B');
  });

  it('Case D — error then retry recovers without modal reopen', async () => {
    const { gates } = await seedBootstrap();
    setBookingV2Selection({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      businessDate: OPS_TOMORROW,
      serviceIds: [1],
      durationMinutes: 30,
    });

    const pFail = prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      force: true,
    });
    gates[0]!.reject(new Error('network down'));
    await pFail;

    expect(getBookingV2StoreSnapshot().availabilityStatus).toBe('error');
    expect(getBookingV2StoreSnapshot().availabilityError).toContain('network down');

    const pRetry = prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      force: true,
    });
    expect(getBookingV2StoreSnapshot().availabilityStatus).toBe('loading');
    const retryGate = gates[gates.length - 1]!;
    retryGate.resolve(matrixForEmp(12, 'rev-retry'));
    await pRetry;

    const snap = getBookingV2StoreSnapshot();
    expect(snap.availabilityStatus).toBe('ready');
    expect(snap.availabilityError).toBeNull();
    expect(snap.generatedStarts.length).toBeGreaterThan(0);
  });

  it('same-key supersede: B succeeds after A abort; status never stuck loading', async () => {
    const { gates } = await seedBootstrap();
    setBookingV2Selection({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      businessDate: OPS_TODAY,
      serviceIds: [1],
      durationMinutes: 30,
    });

    const pA = prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      force: true,
    });
    const pB = prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      force: true,
    });

    expect(getBookingV2StoreSnapshot().availabilityStatus).toBe('loading');
    const gateB = gates[gates.length - 1]!;
    gateB.resolve(matrixForEmp(12, 'rev-same-key-B'));
    await Promise.allSettled([pA, pB]);

    const snap = getBookingV2StoreSnapshot();
    expect(snap.availabilityStatus).toBe('ready');
    expect(snap.availabilityLoadingKey).toBeNull();
    expect(snap.matricesByKey[snap.activeMatrixKey!]?.matrix.days[0]?.availabilityRevision).toBe(
      'rev-same-key-B',
    );
  });
});
