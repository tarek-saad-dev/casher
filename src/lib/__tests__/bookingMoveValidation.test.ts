/**
 * Integration-style tests for the booking-move validation flow.
 *
 * Verifies:
 *  - Error priority: service compatibility is reported before schedule/shift.
 *  - Missing weekly schedule surfaces a distinct NO_SCHEDULE code (scenario 8).
 *  - Final transactional move re-checks service compatibility even when the
 *    pre-validation passed but data changed before the write (scenario 12).
 *  - A valid move commits once service compatibility exists (scenario 13).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mutable fixture state ─────────────────────────────────────────────────────
interface State {
  emp: { EmpID: number; EmpName: string; isActive: number; Job: string } | null;
  activeServiceIds: Set<number>;
  serviceNames: Record<number, string>;
  hasSchedule: boolean;
  isWorkingDay: boolean;
  // Flip to simulate a mid-flight data change (service removed before commit).
  removeServiceAfterPrecheck: number | null;
  tblProReadCount: number;
  updateCalls: number;
  committed: boolean;
  rolledBack: boolean;
}

let state: State;

function resetState(): void {
  state = {
    emp: { EmpID: 5, EmpName: 'كريم', isActive: 1, Job: 'حلاق' },
    activeServiceIds: new Set([1047]),
    serviceNames: { 1047: 'حلاقة فيد' },
    hasSchedule: true,
    isWorkingDay: true,
    removeServiceAfterPrecheck: null,
    tblProReadCount: 0,
    updateCalls: 0,
    committed: false,
    rolledBack: false,
  };
}

// ── Fake mssql request/pool/transaction ───────────────────────────────────────
function runQuery(q: string, inputs: Record<string, unknown>) {
  // loadBookingForReschedule — Bookings header
  if (/FROM \[dbo\]\.\[Bookings\]/.test(q) && /BookingID = @id/.test(q) && /SELECT/i.test(q) && !/UPDATE/i.test(q)) {
    return {
      recordset: [
        {
          BookingID: 1798,
          BookingCode: 'BK-TEST',
          ClientID: 22,
          AssignedEmpID: 5,
          BookingDate: new Date('2026-07-21T00:00:00Z'),
          StartTime: new Date('1970-01-01T23:00:00Z'),
          EndTime: new Date('1970-01-01T23:30:00Z'),
          Status: 'confirmed',
          Notes: null,
          ClientName: 'X',
          EmpName: 'كريم',
        },
      ],
    };
  }
  // BookingServices
  if (/FROM \[dbo\]\.\[BookingServices\]/.test(q) && /SELECT/i.test(q)) {
    return { recordset: [{ ProID: 1047, DurationMinutes: 30 }] };
  }
  // TblEmp lookup
  if (/FROM \[dbo\]\.\[TblEmp\]/.test(q) && /EmpID = @id/.test(q)) {
    return { recordset: state.emp ? [state.emp] : [] };
  }
  // TblPro (service eligibility helper)
  if (/\[dbo\]\.\[TblPro\]/.test(q)) {
    state.tblProReadCount += 1;
    const ids = Object.values(inputs).filter((v): v is number => typeof v === 'number');
    // Simulate a concurrent deletion: the pre-validation (read #1) sees the service,
    // but the transactional guard (read #2) no longer finds it active.
    if (state.removeServiceAfterPrecheck != null && state.tblProReadCount >= 2) {
      state.activeServiceIds.delete(state.removeServiceAfterPrecheck);
    }
    const recordset = ids
      .filter((id) => state.activeServiceIds.has(id))
      .map((id) => ({
        ProID: id,
        ProName: state.serviceNames[id] ?? null,
        ProNameAr: state.serviceNames[id] ?? null,
        isDeleted: 0,
      }));
    return { recordset };
  }
  // hasWeeklySchedule
  if (/FROM \[dbo\]\.\[TblEmpWorkSchedule\]/.test(q)) {
    return { recordset: state.hasSchedule ? [{ ok: 1 }] : [] };
  }
  // UPDATE Bookings
  if (/UPDATE \[dbo\]\.\[Bookings\]/.test(q)) {
    state.updateCalls += 1;
    return { recordset: [], rowsAffected: [1] };
  }
  if (/UPDATE \[dbo\]\.\[BookingServices\]/.test(q)) {
    return { recordset: [], rowsAffected: [1] };
  }
  return { recordset: [] };
}

function makeRequest() {
  const inputs: Record<string, unknown> = {};
  return {
    input(name: string, _t: unknown, val: unknown) {
      inputs[name] = val;
      return this;
    },
    async query(q: string) {
      return runQuery(q, inputs);
    },
  };
}

const fakePool = { request: () => makeRequest() };

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => fakePool),
  sql: {
    Int: { type: 'int' },
    VarChar: { type: 'varchar' },
    NVarChar: { type: 'nvarchar' },
    Date: { type: 'date' },
    Request: class FakeReq {
      inputs: Record<string, unknown> = {};
      constructor(public _tx?: unknown) {}
      input(name: string, _t: unknown, val: unknown) {
        this.inputs[name] = val;
        return this;
      }
      async query(q: string) {
        return runQuery(q, this.inputs);
      }
    },
    Transaction: class FakeTx {
      async begin() {}
      async commit() {
        state.committed = true;
      }
      async rollback() {
        state.rolledBack = true;
      }
      request() {
        return makeRequest();
      }
    },
    ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' },
  },
}));

// ── Collaborator mocks (kept minimal / deterministic) ─────────────────────────
vi.mock('@/lib/publicBookingHelpers', () => ({
  getPublicSettings: vi.fn(async () => ({ timezone: 'Africa/Cairo' })),
  salonDateTimeToMs: (dateStr: string, hhmm: string) =>
    new Date(`${dateStr}T${hhmm}:00+03:00`).getTime(),
}));

vi.mock('@/lib/barberAvailability', () => ({
  getBarberWorkingWindow: vi.fn(async () => ({
    isWorkingDay: state.isWorkingDay,
    startTime: state.isWorkingDay ? '15:30' : null,
    endTime: state.isWorkingDay ? '01:30' : null,
  })),
}));

vi.mock('@/lib/scheduleOverrides', () => ({
  loadOverridesForDate: vi.fn(async () => new Map()),
  applyOverrides: vi.fn((_e: number, _d: string, base: unknown) => ({
    ...(base as object),
    blockedIntervals: [],
  })),
  slotBlockedByOverride: vi.fn(() => false),
}));

vi.mock('@/lib/scheduleIntegrity', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scheduleIntegrity')>(
    '@/lib/scheduleIntegrity',
  );
  return {
    ScheduleConflictError: actual.ScheduleConflictError,
    acquireScheduleLocksSorted: vi.fn(async () => {}),
    assertEmployeeIntervalAvailable: vi.fn(async () => {}),
    getEmployeeBusyIntervals: vi.fn(async () => []),
  };
});

vi.mock('@/lib/bookingAvailabilityEngine', () => ({
  evaluateBookingSlotAt: vi.fn(() => ({ available: true })),
  BOOKING_SLOT_REASON_AR: {},
}));

import {
  validateBookingMove,
  rescheduleBookingMove,
} from '@/lib/bookingRescheduleCore';

beforeEach(() => {
  resetState();
});

const baseArgs = {
  bookingId: 1798,
  newStartAt: '2026-07-21T20:00:00+03:00',
  operationalDate: '2026-07-21',
};

describe('validateBookingMove — error priority', () => {
  it('scenario 13: valid move when barber supports the service', async () => {
    const res = await validateBookingMove({ ...baseArgs, targetEmpId: 5 });
    expect(res.valid).toBe(true);
    expect(res.targetEmpId).toBe(5);
  });

  it('scenario 2: unsupported service → EMPLOYEE_SERVICE_UNSUPPORTED with details', async () => {
    state.activeServiceIds = new Set(); // barber no longer provides 1047
    const res = await validateBookingMove({ ...baseArgs, targetEmpId: 5 });
    expect(res.valid).toBe(false);
    expect(res.code).toBe('EMPLOYEE_SERVICE_UNSUPPORTED');
    expect(res.details?.unsupportedServices?.[0]?.serviceId).toBe(1047);
  });

  it('service failure takes priority over a missing schedule', async () => {
    state.activeServiceIds = new Set();
    state.hasSchedule = false;
    state.isWorkingDay = false;
    const res = await validateBookingMove({ ...baseArgs, targetEmpId: 5 });
    expect(res.code).toBe('EMPLOYEE_SERVICE_UNSUPPORTED');
  });

  it('scenario 8: supports service but no weekly schedule → NO_SCHEDULE', async () => {
    state.isWorkingDay = false;
    state.hasSchedule = false;
    const res = await validateBookingMove({ ...baseArgs, targetEmpId: 5 });
    expect(res.valid).toBe(false);
    expect(res.code).toBe('NO_SCHEDULE');
  });
});

describe('rescheduleBookingMove — final transactional guard', () => {
  it('scenario 13: commits when everything is valid', async () => {
    const res = await rescheduleBookingMove({
      ...baseArgs,
      source: 'operations_cut_paste',
      userId: 1,
      targetEmpId: 5,
    });
    expect(res.newEmpId).toBe(5);
    expect(state.committed).toBe(true);
    expect(state.updateCalls).toBeGreaterThan(0);
  });

  it('scenario 12: pre-validation passes but service removed before commit → blocked in transaction', async () => {
    // Pre-check (1st TblPro read) sees the service; the transactional guard
    // (2nd TblPro read) finds it gone — simulating a concurrent deletion.
    state.removeServiceAfterPrecheck = 1047;

    const err = await rescheduleBookingMove({
      ...baseArgs,
      source: 'operations_cut_paste',
      userId: 1,
      targetEmpId: 5,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe('EMPLOYEE_SERVICE_UNSUPPORTED');
    expect(state.updateCalls).toBe(0);
    expect(state.rolledBack).toBe(true);
  });
});
