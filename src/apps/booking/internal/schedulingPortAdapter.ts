import 'server-only';
import type { Transaction } from 'mssql';
import type { BookingSchedulingPorts } from '../public/ports';
import { tenantLockResource } from '@/platform/public';
import { sql } from '@/lib/db';

async function acquireTransactionApplock(
  transaction: Transaction,
  resource: string,
  timeoutMs = 5000,
): Promise<void> {
  const result = await new sql.Request(transaction)
    .input('resource', sql.NVarChar(255), resource)
    .input('timeout', sql.Int, timeoutMs)
    .query(`
      DECLARE @r INT;
      EXEC @r = sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = @timeout;
      SELECT @r AS lockResult;
    `);
  const lockResult = Number(result.recordset[0].lockResult);
  if (lockResult < 0) {
    throw new Error('BOOKING_SCHEDULING_LOCK_TIMEOUT');
  }
}

/**
 * Occupancy + customer helpers invoked from legacy scheduling flows when the
 * extracted port path is active.
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
        excludeRefs?: string[];
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
      });
    },

    async acquireEmpIntervalLock(
      tx: Transaction,
      employeeId: number,
      startMs: number,
      endMs: number,
    ): Promise<void> {
      const resource = tenantLockResource(deps.tenantId, [
        'emp',
        String(employeeId),
        String(startMs),
        String(endMs),
      ]);
      await acquireTransactionApplock(tx, resource);
    },

    async acquireAnyBarberLock(
      tx: Transaction,
      locationId: number,
      startMs: number,
      endMs: number,
      slotKey: string,
    ): Promise<void> {
      const resource = tenantLockResource(deps.tenantId, [
        'loc',
        String(locationId),
        'any-barber',
        slotKey,
      ]);
      await acquireTransactionApplock(tx, resource);
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
