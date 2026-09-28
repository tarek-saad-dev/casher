import 'server-only';
import type { Transaction } from 'mssql';
import type { BookingSchedulingPorts } from '../public/ports';

/**
 * Occupancy + customer helpers invoked from legacy scheduling flows when the
 * extracted port path is active. Scheduling applocks stay inside Workforce (D6).
 */
export function createSchedulingPortHooks(deps: BookingSchedulingPorts) {
  return {
    async upsertCustomer(
      tx: Transaction,
      input: { phone: string; displayName: string },
    ): Promise<number> {
      return deps.customers.upsertByPhone(tx, deps.actor, {
        phone: input.phone,
        displayName: input.displayName,
      });
    },

    async assertEmployeeFree(
      tx: Transaction,
      input: {
        employeeId: number;
        startMs: number;
        endMs: number;
        operationalDate?: string;
        branchId?: number;
        excludeRefs?: string[];
        excludeHoldKey?: string | null;
      },
    ): Promise<void> {
      await deps.occupancy.lock(tx, deps.actor, {
        employeeId: input.employeeId,
        intervals: [{ startMs: input.startMs, endMs: input.endMs }],
      });
      await deps.occupancy.assertFree(tx, deps.actor, {
        employeeId: input.employeeId,
        interval: { startMs: input.startMs, endMs: input.endMs },
        excludeRefs: input.excludeRefs,
        operationalDate: input.operationalDate,
        branchId: input.branchId,
        excludeHoldKey: input.excludeHoldKey ?? null,
      });
    },

    async acquireEmpIntervalLock(
      tx: Transaction,
      employeeId: number,
      startMs: number,
      endMs: number,
    ): Promise<void> {
      await deps.occupancy.lock(tx, deps.actor, {
        employeeId,
        intervals: [{ startMs, endMs }],
      });
    },

    async acquireAnyBarberLock(
      tx: Transaction,
      locationId: number,
      startMs: number,
      endMs: number,
      slotKey: string,
    ): Promise<void> {
      await deps.occupancy.lockAnyBarber(tx, deps.actor, {
        locationId,
        startMs,
        endMs,
        slotKey,
      });
    },

    async commitOccupancy(
      tx: Transaction,
      input: {
        employeeId: number;
        startMs: number;
        endMs: number;
        ref: string;
        locationId: number;
      },
    ): Promise<void> {
      await deps.occupancy.commit(tx, deps.actor, {
        employeeId: input.employeeId,
        interval: { startMs: input.startMs, endMs: input.endMs },
        ref: input.ref,
        locationId: input.locationId,
        source: 'booking',
      });
    },

    async releaseOccupancy(tx: Transaction, ref: string): Promise<void> {
      await deps.occupancy.release(tx, deps.actor, { ref });
    },

    async publishSchedulingEvent(
      tx: Transaction,
      input: {
        eventType: 'booking.created' | 'booking.cancelled' | 'booking.rescheduled' | 'booking.completed';
        bookingId: number;
        bookingCode?: string | null;
        payload: Record<string, unknown>;
        idempotencyKey: string;
      },
    ): Promise<number> {
      return deps.publishOutbox(tx, {
        aggregateType: 'booking',
        aggregateId: String(input.bookingId),
        eventType: input.eventType,
        payload: JSON.stringify({
          tenantId: deps.tenantId,
          bookingId: input.bookingId,
          bookingCode: input.bookingCode ?? null,
          ...input.payload,
        }),
        idempotencyKey: input.idempotencyKey,
        correlationId: input.bookingCode ?? String(input.bookingId),
      });
    },

    catalog: deps.catalog,
    calendar: deps.calendar,
    conversion: deps.conversion,
    tenantId: deps.tenantId,
    actor: deps.actor,
  };
}

export type SchedulingPortHooks = ReturnType<typeof createSchedulingPortHooks>;
