import { beforeEach, describe, expect, it, vi } from 'vitest';

// These exercise the actual reserveAddon/previewAddon functions with a stateful
// SQL simulator. A real isolated-DB run is still required before production.
const sim = vi.hoisted(() => ({
  booking: {
    BookingID: 123, BranchID: 1, BookingDate: '2030-01-12',
    PublicWorkDate: '2030-01-12', StartTime: '12:00', EndTime: '12:30',
    AbsoluteEndUtc: new Date('2030-01-12T10:30:00.000Z'),
    Status: 'confirmed', ConvertedInvID: null as null | number,
    TotalDuration: 30,
  },
  service: { ProID: 9, ProName: 'Hair Cut', DurationMinutes: 20, SPrice1: 200 },
  rows: [] as Array<{ proId: number; empId: number; duration: number }>,
  failInsert: false,
  busy: false,
  handoffSent: false,
  overrides: {} as Record<number, number>,
  mutex: Promise.resolve() as Promise<void>,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => {
  class MockTx {
    pendingEnd: { time: string; absolute: Date } | null = null;
    pendingService: { proId: number; empId: number; duration: number } | null = null;
    unlock?: () => void;
    async begin() {}
    async commit() {
      if (this.pendingEnd) {
        sim.booking.EndTime = this.pendingEnd.time;
        sim.booking.AbsoluteEndUtc = this.pendingEnd.absolute;
      }
      if (this.pendingService) {
        sim.rows.push(this.pendingService);
        sim.booking.TotalDuration += this.pendingService.duration;
      }
      this.unlock?.();
    }
    async rollback() { this.unlock?.(); }
  }
  class MockRequest {
    values: Record<string, any> = {};
    constructor(private db: any) {}
    input(key: string, _type: unknown, value: unknown) {
      this.values[key] = value;
      return this;
    }
    async query(query: string): Promise<{ recordset: any[]; rowsAffected?: number[] }> {
      if (query.includes('FROM dbo.Bookings b')) {
        if (this.values.bid !== sim.booking.BookingID ||
            this.values.emp !== 7 || this.values.tenant !== 'tenant-test') {
          return { recordset: [] };
        }
        return { recordset: [{ ...sim.booking }] };
      }
      if (query.includes('FROM dbo.TblPro')) {
        return { recordset: this.values.proId === 9 ? [{ ...sim.service }] : [] };
      }
      if (query.includes('FROM dbo.TblEmpServiceSettings')) {
        const duration = sim.overrides[this.values.empId];
        return { recordset: duration ? [{ DurationMinutes: duration }] : [] };
      }
      if (query.includes('FROM dbo.TblBookingCashierHandoff')) {
        return { recordset: sim.handoffSent ? [{ HandoffID: 12 }] : [] };
      }
      if (query.includes('FROM dbo.TblEmp WHERE TenantId')) {
        return { recordset: [{ EmpID: 8, EmpName: 'Alternate' }] };
      }
      if (query.includes('UPDATE dbo.Bookings SET EndTime=')) {
        if (!(this.db instanceof MockTx)) throw new Error('Booking extension outside TX');
        this.db.pendingEnd = { time: this.values.endTime, absolute: this.values.absEnd };
        return { recordset: [], rowsAffected: [1] };
      }
      if (query.includes('INSERT INTO dbo.BookingServices')) {
        if (!(this.db instanceof MockTx)) throw new Error('Extra service outside TX');
        if (sim.failInsert) throw new Error('SIMULATED_INSERT_FAILURE');
        this.db.pendingService = {
          proId: this.values.proId, empId: this.values.empId, duration: this.values.minutes,
        };
        return { recordset: [], rowsAffected: [1] };
      }
      throw new Error('Unmocked SQL: ' + query.slice(0, 120));
    }
  }
  const pool = { request: () => new MockRequest(pool), transaction: () => new MockTx() };
  return {
    getPool: vi.fn(async () => pool),
    sql: {
      Request: MockRequest,
      ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
      Int: 'int', DateTime2: 'datetime2',
      NVarChar: () => 'nvarchar', VarChar: () => 'varchar',
      Decimal: () => 'decimal',
    },
  };
});

vi.mock('@/lib/scheduleIntegrity', () => {
  class ScheduleConflictError extends Error {}
  return {
    ScheduleConflictError,
    acquireEmployeeScheduleLock: vi.fn(async (tx: { unlock?: () => void }) => {
      const previous = sim.mutex;
      let unlock!: () => void;
      sim.mutex = new Promise<void>((resolve) => { unlock = resolve; });
      await previous;
      tx.unlock = unlock;
    }),
    assertEmployeeIntervalAvailable: vi.fn(async ({ empId }: { empId: number }) => {
      if (sim.busy && empId === 7) throw new ScheduleConflictError('Next customer has priority');
    }),
  };
});
vi.mock('@/lib/booking/AvailabilityMutationNotifier', () => ({
  AvailabilityMutationNotifier: { bookingOccupancyChanged: vi.fn(async () => {}) },
}));

import { previewAddon, reserveAddon, AddonGuardError } from '@/lib/employee-portal/bookingAddonAvailability';
import { assertEmployeeIntervalAvailable } from '@/lib/scheduleIntegrity';

const actor = { bookingId: 123, empId: 7, tenantId: 'tenant-test', proId: 9 };

beforeEach(() => {
  sim.booking = {
    BookingID: 123, BranchID: 1, BookingDate: '2030-01-12',
    PublicWorkDate: '2030-01-12', StartTime: '12:00', EndTime: '12:30',
    AbsoluteEndUtc: new Date('2030-01-12T10:30:00.000Z'),
    Status: 'confirmed', ConvertedInvID: null, TotalDuration: 30,
  };
  sim.rows = [];
  sim.failInsert = false;
  sim.busy = false;
  sim.handoffSent = false;
  sim.overrides = {};
  sim.mutex = Promise.resolve();
  vi.clearAllMocks();
});

describe('CUT STAFF add-on booking behavior (mock SQL + real server functions)', () => {
  it('previews free time with no writes, then atomically reserves 20 minutes and a service row', async () => {
    const preview = await previewAddon(actor);
    expect(preview.available).toBe(true);
    expect(preview.durationMinutes).toBe(20);
    expect(sim.rows).toHaveLength(0);
    expect(sim.booking.EndTime).toBe('12:30');

    const saved = await reserveAddon({ ...actor, expectedEndAt: preview.expectedEndAt });
    expect(saved.ok).toBe(true);
    expect(sim.booking.EndTime).toBe('12:50');
    expect(sim.booking.AbsoluteEndUtc.toISOString()).toBe('2030-01-12T10:50:00.000Z');
    expect(sim.rows).toEqual([{ proId: 9, empId: 7, duration: 20 }]);
    expect(assertEmployeeIntervalAvailable).toHaveBeenCalled();
  });

  it('refuses conflicting next reservation and suggests an alternative without adding anything', async () => {
    sim.busy = true;
    const preview = await previewAddon(actor);
    expect(preview.available).toBe(false);
    expect(preview.alternatives[0]?.empId).toBe(8);
    expect(sim.rows).toHaveLength(0);
    const saved = await reserveAddon({ ...actor, expectedEndAt: preview.expectedEndAt });
    expect(saved).toMatchObject({ ok: false, status: 409 });
    expect(sim.booking.EndTime).toBe('12:30');
    expect(sim.rows).toHaveLength(0);
  });

  it('only one of two concurrent confirmations of the same preview is committed', async () => {
    const preview = await previewAddon(actor);
    const [a, b] = await Promise.all([
      reserveAddon({ ...actor, expectedEndAt: preview.expectedEndAt }),
      reserveAddon({ ...actor, expectedEndAt: preview.expectedEndAt }),
    ]);
    expect([a, b].filter(v => v.ok)).toHaveLength(1);
    expect([a, b].filter(v => !v.ok)).toHaveLength(1);
    expect(sim.rows).toHaveLength(1);
    expect(sim.booking.EndTime).toBe('12:50');
  });

  it('rolls back both reservation and item on service-row insert failure', async () => {
    sim.failInsert = true;
    const preview = await previewAddon(actor);
    const saved = await reserveAddon({ ...actor, expectedEndAt: preview.expectedEndAt });
    expect(saved).toMatchObject({ ok: false, status: 503 });
    expect(sim.booking.EndTime).toBe('12:30');
    expect(sim.rows).toHaveLength(0);
  });

  it('refuses an unapproved extra service when cashier has already received the handoff', async () => {
    sim.handoffSent = true;
    await expect(previewAddon(actor)).rejects.toBeInstanceOf(AddonGuardError);
    const result = await reserveAddon({ ...actor, expectedEndAt: '2030-01-12T10:30:00.000Z' });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(sim.rows).toHaveLength(0);
  });

  it('respects an employee-specific 25-minute duration override', async () => {
    sim.overrides[7] = 25;
    const preview = await previewAddon(actor);
    expect(preview.durationMinutes).toBe(25);
    const saved = await reserveAddon({ ...actor, expectedEndAt: preview.expectedEndAt });
    expect(saved.ok).toBe(true);
    expect(sim.booking.EndTime).toBe('12:55');
    expect(sim.rows[0]?.duration).toBe(25);
  });

  it('preserves next-day occupancy when a late booking crosses midnight', async () => {
    sim.booking.StartTime = '23:50';
    sim.booking.EndTime = '00:20';
    sim.booking.AbsoluteEndUtc = new Date('2030-01-12T22:20:00.000Z');
    const preview = await previewAddon(actor);
    expect(preview.available).toBe(true);
    expect(preview.expectedEndAt).toBe('2030-01-12T22:20:00.000Z');
    const result = await reserveAddon({ ...actor, expectedEndAt: preview.expectedEndAt });
    expect(result.ok).toBe(true);
    expect(sim.booking.EndTime).toBe('00:40');
    expect(sim.booking.AbsoluteEndUtc.toISOString()).toBe('2030-01-12T22:40:00.000Z');
    expect(sim.booking.TotalDuration).toBe(50);
  });

  it('denies cross-employee or cross-tenant access', async () => {
    await expect(previewAddon({ ...actor, empId: 88 })).rejects.toMatchObject({ status: 404 });
    await expect(previewAddon({ ...actor, tenantId: 'someone-else' })).rejects.toMatchObject({ status: 404 });
  });
});
