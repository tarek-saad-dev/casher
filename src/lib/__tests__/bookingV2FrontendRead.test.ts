/**
 * Booking V2 Phase B9 — frontend read APIs (pure slot generation + contracts).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import { AvailabilityComposer } from '@/lib/booking/projection/AvailabilityComposer';
import {
  BOOKING_TZ,
  businessDateTimeToEpochMs,
} from '@/lib/booking/domain/BusinessDate';
import {
  composeEmployeeDayAvailabilityV2,
  type ResolveBookingAvailabilityV2PreloadedDay,
} from '@/lib/booking/projection/resolveBookingAvailabilityV2';
import type { WeeklyBaselineSourceInputs } from '@/lib/booking/domain/WeeklyBaseline';
import {
  generateStartsFromFree,
  SLOT_GENERATION_CONTRACT,
} from '@/lib/booking/v2Frontend/generateStartsFromFreeRanges';
import { BOOKING_V2_FRONTEND_CONTRACT } from '@/lib/booking/v2Frontend/publicSafeDtos';

const EMP = 12;
const BRANCH = 1;
const DATE = '2026-08-17';

function weekly(): WeeklyBaselineSourceInputs {
  return {
    key: { employeeId: EMP, branchId: BRANCH, dayOfWeek: 1 },
    employeeWindows: [{ startHhmm: '16:00', endHhmm: '02:00' }],
    isEmployeeWorkingDay: true,
    branchHours: null,
    branchIsOpen: true,
  };
}

function day(): ResolveBookingAvailabilityV2PreloadedDay {
  return {
    employeeId: EMP,
    branchId: BRANCH,
    businessDate: DATE,
    weeklyBaselineInputs: weekly(),
    layers: { blockRanges: [], dailyAdjustments: [] },
    bookingIntervals: [],
    holdIntervals: [],
    queueIntervals: [],
  };
}

describe('LOCAL SLOT GENERATION CONTRACT', () => {
  it('documents FreeMask + duration + interval formula', () => {
    expect(SLOT_GENERATION_CONTRACT.formula).toContain('FreeMask');
    expect(BOOKING_V2_FRONTEND_CONTRACT).toBe('booking-v2-frontend-read-v1');
  });

  it('matches server compose for 15/30/45/60', () => {
    const base = day();
    for (const dur of [15, 30, 45, 60]) {
      const server = composeEmployeeDayAvailabilityV2({
        day: base,
        durationMinutes: dur,
        slotIntervalMinutes: 15,
        includeStarts: true,
      });
      const client = generateStartsFromFree({
        freeRanges: server.freeRanges,
        freeMaskB64: AvailabilityBitmap.fromFreeRanges(server.freeRanges).toBase64(),
        durationMinutes: dur,
        slotIntervalMinutes: 15,
        businessDate: DATE,
      });
      expect(client.startMins).toEqual(
        server.availableStarts.map((s) => s.startMin),
      );
      expect(client.starts.map((s) => `${s.dayOffset}|${s.time}`)).toEqual(
        server.availableStarts.map((s) => `${s.dayOffset}|${s.time}`),
      );
    }
  });

  it('overnight starts use dayOffset=1 without client inventing BusinessDate', () => {
    const server = composeEmployeeDayAvailabilityV2({
      day: day(),
      durationMinutes: 30,
      slotIntervalMinutes: 15,
    });
    const overnight = server.availableStarts.filter((s) => s.dayOffset === 1);
    expect(overnight.length).toBeGreaterThan(0);
    const client = generateStartsFromFree({
      freeRanges: server.freeRanges,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      businessDate: DATE,
    });
    expect(client.starts.some((s) => s.dayOffset === 1 && s.time.startsWith('00'))).toBe(
      true,
    );
  });

  it('includeStarts=false skips starts but keeps freeRanges', () => {
    const r = composeEmployeeDayAvailabilityV2({
      day: day(),
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      includeStarts: false,
    });
    expect(r.availableStarts).toHaveLength(0);
    expect(r.freeRanges.length).toBeGreaterThan(0);
  });
});

describe('COMPACT PAYLOAD + PUBLIC-SAFE', () => {
  it('freeMaskB64 is 72-byte bitmap (~96 chars)', () => {
    const bm = AvailabilityBitmap.empty().setRange(16 * 60, 26 * 60);
    const b64 = bm.toBase64();
    expect(b64.length).toBeLessThan(130);
    expect(AvailabilityBitmap.fromBase64(b64).toFreeRanges()).toEqual(
      bm.toFreeRanges(),
    );
  });

  it('bootstrap/matrix DTOs omit payroll/private fields', () => {
    const dtoSrc = readFileSync(
      join(process.cwd(), 'src/lib/booking/v2Frontend/publicSafeDtos.ts'),
      'utf8',
    );
    // Strip comments before scanning for forbidden identifiers.
    const codeOnly = dtoSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/\bsalary\b|\bpayroll\b|\bwage\b|\bprivateNote\b|\badminOnly\b/i);
    expect(dtoSrc).toContain('V2PublicBootstrapResponse');
    expect(dtoSrc).toContain('V2PublicAvailabilityDayDto');
  });
});

describe('ROUTES + LEGACY V7 UNCHANGED', () => {
  it('adds v2 routes without removing v7 available-slots', () => {
    const root = process.cwd();
    const bootstrap = readFileSync(
      join(root, 'src/app/api/public/booking/v2/bootstrap/route.ts'),
      'utf8',
    );
    const matrix = readFileSync(
      join(root, 'src/app/api/public/booking/v2/availability/route.ts'),
      'utf8',
    );
    const v7slots = readFileSync(
      join(root, 'src/app/api/public/booking/available-slots/route.ts'),
      'utf8',
    );
    const cors = readFileSync(
      join(root, 'src/lib/booking/publicBookingCors.ts'),
      'utf8',
    );
    expect(bootstrap).toContain('buildPublicBookingV2Bootstrap');
    expect(bootstrap).toContain('ETag');
    expect(matrix).toContain('buildPublicAvailabilityMatrix');
    expect(v7slots).toContain('getPublicAvailableSlots');
    expect(cors).toContain("'v2-bootstrap'");
    expect(cors).toContain("'v2-availability'");
  });

  it('matrix uses V2 live resolver (no route-local availability logic)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/booking/v2Frontend/buildAvailabilityMatrix.ts'),
      'utf8',
    );
    expect(src).toContain('resolveBookingAvailabilityV2Live');
    expect(src).toContain('includeStarts: false');
    expect(src).not.toContain('listAvailableBookingSlots');
  });
});

describe('OCCUPANCY REFLECTED IN FREEMASK', () => {
  it('booking occupancy shrinks free ranges used by client generation', () => {
    const base = day();
    const startAtMs = businessDateTimeToEpochMs({
      businessDate: DATE,
      clockTimeHhmm: '20:00',
      timeZone: BOOKING_TZ,
    });
    const endAtMs = startAtMs + 30 * 60_000;
    const open = composeEmployeeDayAvailabilityV2({
      day: base,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      includeStarts: false,
    });
    const busy = composeEmployeeDayAvailabilityV2({
      day: {
        ...base,
        bookingIntervals: [
          { id: 1, startAtMs, endAtMs, branchId: BRANCH },
        ],
      },
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      includeStarts: false,
    });
    const sum = (ranges: Array<{ startMin: number; endMin: number }>) =>
      ranges.reduce((a, r) => a + (r.endMin - r.startMin), 0);
    expect(sum(busy.freeRanges)).toBeLessThan(sum(open.freeRanges));
    const clientOpen = generateStartsFromFree({
      freeRanges: open.freeRanges,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      businessDate: DATE,
    });
    const clientBusy = generateStartsFromFree({
      freeRanges: busy.freeRanges,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      businessDate: DATE,
    });
    expect(clientBusy.starts.length).toBeLessThan(clientOpen.starts.length);
    expect(clientBusy.starts.some((s) => s.time === '20:00')).toBe(false);
  });

  it('hold + queue occupancy also shrink free ranges', () => {
    const base = day();
    const holdStart = businessDateTimeToEpochMs({
      businessDate: DATE,
      clockTimeHhmm: '18:00',
      timeZone: BOOKING_TZ,
    });
    const queueStart = businessDateTimeToEpochMs({
      businessDate: DATE,
      clockTimeHhmm: '21:00',
      timeZone: BOOKING_TZ,
    });
    const open = composeEmployeeDayAvailabilityV2({
      day: base,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      includeStarts: false,
    });
    const busy = composeEmployeeDayAvailabilityV2({
      day: {
        ...base,
        holdIntervals: [
          { id: 'h1', startAtMs: holdStart, endAtMs: holdStart + 30 * 60_000, branchId: BRANCH },
        ],
        queueIntervals: [
          { id: 'q1', startAtMs: queueStart, endAtMs: queueStart + 30 * 60_000, branchId: BRANCH },
        ],
      },
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      includeStarts: false,
    });
    const sum = (ranges: Array<{ startMin: number; endMin: number }>) =>
      ranges.reduce((a, r) => a + (r.endMin - r.startMin), 0);
    expect(sum(busy.freeRanges)).toBeLessThan(sum(open.freeRanges));
  });
});

describe('OVERRIDE / CLOSED / MULTI-SCOPE', () => {
  it('close-day override yields no free ranges', () => {
    const r = composeEmployeeDayAvailabilityV2({
      day: {
        ...day(),
        layers: { closeDay: true, blockRanges: [], dailyAdjustments: [] },
      },
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      includeStarts: false,
    });
    expect(r.freeRanges).toHaveLength(0);
    const client = generateStartsFromFree({
      freeRanges: r.freeRanges,
      durationMinutes: 30,
      slotIntervalMinutes: 15,
      businessDate: DATE,
    });
    expect(client.starts).toHaveLength(0);
  });

  it('matrix request shape supports multi-branch + any-barber scopes', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/booking/v2Frontend/buildAvailabilityMatrix.ts'),
      'utf8',
    );
    expect(src).toContain('branchCodes');
    expect(src).toContain('listBookableEmployeeIdsForBranch');
    expect(src).toContain('publicOnly: true');
    expect(src).toMatch(/Any-barber|any-barber|branch roster/i);
  });

  it('bootstrap revision + cache invalidation are wired', () => {
    const boot = readFileSync(
      join(process.cwd(), 'src/lib/booking/v2Frontend/buildPublicBootstrap.ts'),
      'utf8',
    );
    const services = readFileSync(
      join(process.cwd(), 'src/lib/booking/publicBookingServices.ts'),
      'utf8',
    );
    const barbers = readFileSync(
      join(process.cwd(), 'src/lib/booking/publicBookingBarbers.ts'),
      'utf8',
    );
    expect(boot).toContain('invalidatePublicBookingV2Bootstrap');
    expect(boot).toContain('getStaticBootstrapCache');
    expect(boot).toContain('revision');
    expect(services).toContain('invalidatePublicBookingV2Bootstrap');
    expect(barbers).toContain('invalidatePublicBookingV2Bootstrap');
    expect(boot).not.toContain('freeRanges');
    expect(boot).not.toContain('availableStarts');
  });

  it('compact 14-day single-barber payload stays mobile-friendly', () => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const composed = composeEmployeeDayAvailabilityV2({
        day: {
          ...day(),
          businessDate: `2026-08-${String(17 + i).padStart(2, '0')}`,
        },
        durationMinutes: 30,
        slotIntervalMinutes: 15,
        includeStarts: false,
      });
      const freeMask = AvailabilityBitmap.fromFreeRanges(composed.freeRanges);
      return {
        employeeId: EMP,
        branchId: BRANCH,
        branchCode: 'GLEEM',
        businessDate: composed.businessDate,
        availabilityRevision: composed.availabilityRevision,
        freeRanges: composed.freeRanges,
        freeMaskB64: freeMask.toBase64(),
        timezone: BOOKING_TZ,
        businessDayStartAtMs: 0,
        timelineEndAtMs: 0,
        hasOvernightFree: true,
        isAvailable: composed.freeRanges.length > 0,
      };
    });
    const payload = {
      ok: true,
      contract: BOOKING_V2_FRONTEND_CONTRACT,
      days,
    };
    const jsonBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    // Compact FreeMask matrix should stay well under ~80KB uncompressed for 1×14.
    expect(jsonBytes).toBeLessThan(80_000);
    expect(days.every((d) => d.availabilityRevision)).toBe(true);
  });
});
