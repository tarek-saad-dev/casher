/**
 * Booking V2 Phase O2 — Instant Booking UX acceptance (Hawai /operations).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import {
  BOOKING_V2_OPS_DATA_LAYER,
  filterDaysForSelection,
  generateStartsForDay,
  getBookingV2StoreSnapshot,
  hasCachedBranchInActiveMatrix,
  matrixScopeKey,
  prefetchBookingV2Availability,
  resetBookingV2StoreForTests,
  setBookingV2Selection,
  scopeToRequest,
} from '@/lib/operations/bookingV2';
import { clearBootstrapClientCache } from '@/lib/operations/bookingV2/bootstrapClient';
import { clearAvailabilityInflight } from '@/lib/operations/bookingV2/availabilityClient';
import type { V2PublicAvailabilityDayDto } from '@/lib/booking/v2Frontend/publicSafeDtos';

const root = process.cwd();

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
  revision: 'o2-rev',
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
      branchCodes: ['GLEEM', 'CAMP_CAESAR'],
    },
  ],
  employeeBranchMappings: [
    { employeeId: 12, branchId: 1, branchCode: 'GLEEM' },
    { employeeId: 12, branchId: 2, branchCode: 'CAMP_CAESAR' },
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
};

const matrix = {
  ok: true as const,
  contract: 'booking-v2-frontend-read-v1' as const,
  generatedAt: new Date().toISOString(),
  timezone: 'Africa/Cairo',
  slotIntervalMinutes: 15,
  fromBusinessDate: '2026-08-17',
  toBusinessDate: '2026-08-30',
  durationMinutes: null,
  days: [
    dayCell({ employeeId: 12, branchCode: 'GLEEM', businessDate: '2026-08-17' }),
    dayCell({
      employeeId: 12,
      branchCode: 'CAMP_CAESAR',
      businessDate: '2026-08-17',
      branchId: 2,
    }),
    dayCell({ employeeId: 12, branchCode: 'GLEEM', businessDate: '2026-08-18' }),
  ],
};

describe('OPERATIONS INSTANT BOOKING UX VERIFIED', () => {
  beforeEach(() => {
    resetBookingV2StoreForTests();
    clearBootstrapClientCache();
    clearAvailabilityInflight();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetBookingV2StoreForTests();
    clearBootstrapClientCache();
    clearAvailabilityInflight();
  });

  function stubFetch() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v2/bootstrap')) {
        return {
          ok: true,
          status: 200,
          json: async () => bootstrap,
          headers: { get: (h: string) => (h.toLowerCase() === 'etag' ? 'W/"o2-rev"' : null) },
        };
      }
      if (url.includes('/v2/availability')) {
        return {
          ok: true,
          status: 200,
          json: async () => matrix,
          headers: { get: () => null },
        };
      }
      if (url.includes('/available-slots') || url.includes('resolve-durations')) {
        throw new Error(`FORBIDDEN waterfall call: ${url}`);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('MODAL OPENS IMMEDIATELY — open path does not await reads', () => {
    const page = readFileSync(join(root, 'src/app/operations/page.tsx'), 'utf8');
    expect(page).toContain("setShowBookingDrawer(true)");
    expect(page).toContain('markOpsBookingUx(\'add_click\'');
    expect(page).toContain('void openBookingV2Flow');
    const ws = readFileSync(
      join(root, 'src/components/operations/booking-workspace/useBookingWorkspace.ts'),
      'utf8',
    );
    expect(ws).toContain("markOpsBookingUx('modal_visible')");
    expect(ws).not.toContain('await openBookingV2Flow');
  });

  it('NO STEP-BY-STEP AVAILABILITY WATERFALL + REDUNDANT READ CALLS REMOVED', () => {
    const ws = readFileSync(
      join(root, 'src/components/operations/booking-workspace/useBookingWorkspace.ts'),
      'utf8',
    );
    expect(ws).not.toContain('/api/public/booking/available-slots');
    expect(ws).not.toContain('/api/services/resolve-durations');
    expect(ws).toContain('prefetchBookingV2Availability');
    // services fallback only on bootstrap error — not per open happy path
    expect(ws).toContain("bootstrapStatus !== 'error'");
  });

  it('SERVICE / DATE / CACHED BRANCH CHANGE ZERO NETWORK', async () => {
    const fetchMock = stubFetch();
    setBookingV2Selection({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      businessDate: '2026-08-17',
      serviceIds: [1],
      durationMinutes: 30,
    });
    await prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      force: true,
    });
    const afterPrefetch = fetchMock.mock.calls.length;

    setBookingV2Selection({ durationMinutes: 45, serviceIds: [1, 2] });
    setBookingV2Selection({ businessDate: '2026-08-18' });
    expect(hasCachedBranchInActiveMatrix('CAMP_CAESAR')).toBe(true);
    setBookingV2Selection({ branchCode: 'CAMP_CAESAR', businessDate: '2026-08-17' });

    const snap = getBookingV2StoreSnapshot();
    expect(snap.generatedStarts.every((s) => s.branchCode === 'CAMP_CAESAR')).toBe(true);
    expect(snap.generatedStarts.every((s) => s.durationMinutes === 45)).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(afterPrefetch);
    expect(BOOKING_V2_OPS_DATA_LAYER).toBe('booking-v2-ops-o1');
  });

  it('MULTI-BRANCH BARBER INSTANT — one request then local filter', () => {
    const req = scopeToRequest({
      kind: 'employee',
      employeeId: 12,
      branchCodes: ['GLEEM', 'CAMP_CAESAR'],
      fromBusinessDate: '2026-08-17',
      toBusinessDate: '2026-08-30',
    });
    expect(req.branchCodes).toEqual(['GLEEM', 'CAMP_CAESAR']);
    const key = matrixScopeKey({
      kind: 'employee',
      employeeId: 12,
      branchCodes: ['GLEEM', 'CAMP_CAESAR'],
      fromBusinessDate: '2026-08-17',
      toBusinessDate: '2026-08-30',
    });
    expect(key).toContain('CAMP_CAESAR');
    expect(key).toContain('GLEEM');

    const gleem = filterDaysForSelection({
      days: matrix.days,
      businessDate: '2026-08-17',
      employeeId: 12,
      branchCode: 'GLEEM',
    });
    const camp = filterDaysForSelection({
      days: matrix.days,
      businessDate: '2026-08-17',
      employeeId: 12,
      branchCode: 'CAMP_CAESAR',
    });
    expect(gleem).toHaveLength(1);
    expect(camp).toHaveLength(1);
  });

  it('LOADING ERROR EMPTY STATES SEPARATED', () => {
    const step = readFileSync(
      join(root, 'src/components/operations/booking-workspace/BookingStepAppointment.tsx'),
      'utf8',
    );
    expect(step).toContain('جاري تحميل المواعيد');
    expect(step).toContain('لا توجد مواعيد متاحة');
    expect(step).toContain('تعذر تحميل المواعيد');
    expect(step).toContain('إعادة المحاولة');
    expect(step).toContain('slotsViewState');
    expect(step).toContain('هذا ليس معناه أن الموظف بلا مواعيد');
  });

  it('BUSINESSDATE OVERNIGHT VERIFIED', () => {
    const day = dayCell({
      employeeId: 12,
      branchCode: 'GLEEM',
      businessDate: '2026-08-17',
      freeRanges: [{ startMin: 16 * 60, endMin: 26 * 60 }],
    });
    const starts = generateStartsForDay({
      day,
      durationMinutes: 30,
      settings: bootstrap.settingsByBranch.GLEEM,
      barberName: 'زياد',
      nowMs: 0,
    });
    const overnight = starts.filter((s) => s.dayOffset === 1);
    expect(overnight.length).toBeGreaterThan(0);
    expect(overnight.every((s) => s.businessDate === '2026-08-17')).toBe(true);
    const types = readFileSync(
      join(root, 'src/components/operations/booking-workspace/types.ts'),
      'utf8',
    );
    expect(types).toContain('بعد منتصف الليل');
  });

  it('LEGACY WRITE PRESERVED', () => {
    const ws = readFileSync(
      join(root, 'src/components/operations/booking-workspace/useBookingWorkspace.ts'),
      'utf8',
    );
    expect(ws).toContain("/api/public/booking/create");
    expect(ws).not.toContain('/api/public/booking/v2/create');
  });

  it('soft matrix refresh does not clear ready status when cache exists', async () => {
    const fetchMock = stubFetch();
    setBookingV2Selection({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      businessDate: '2026-08-17',
      serviceIds: [1],
      durationMinutes: 30,
    });
    await prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      force: true,
    });
    const before = getBookingV2StoreSnapshot().generatedStarts.length;
    expect(before).toBeGreaterThan(0);

    await prefetchBookingV2Availability({
      mode: 'specific',
      employeeId: 12,
      branchCode: 'GLEEM',
      force: true,
    });
    const after = getBookingV2StoreSnapshot();
    expect(after.availabilityStatus).toBe('ready');
    expect(after.generatedStarts.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});
