import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { tenantLockResource } from '@/platform/public';
import type { ActorContext } from '@/platform/public';
import type { OccupancyPort } from '../public/ports';

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
    throw new Error('WORKFORCE_OCCUPANCY_LOCK_TIMEOUT');
  }
}

function excludeBookingIdFromRefs(refs: string[] | undefined): number | undefined {
  if (!refs) return undefined;
  for (const ref of refs) {
    const match = /^booking:(\d+)$/.exec(ref);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/**
 * Workforce occupancy port — delegates to legacy applocks and busy-interval reads.
 * Booking/Queue must not SQL-read occupancy tables directly once DRVO-004 lands.
 */
export function createLegacyWorkforceOccupancyAdapter(
  tenantId: string,
): OccupancyPort {
  return {
    async lock(tx, _actor, input) {
      for (const interval of input.intervals) {
        // Same string as empIntervalLockResource. Flag-off booking and any caller
        // that still takes the legacy applock must serialize with this port.
        const legacyResource = `booking:emp:${input.employeeId}:${interval.startMs}:${interval.endMs}`;
        const tenantResource = tenantLockResource(tenantId, [
          'emp',
          String(input.employeeId),
          String(interval.startMs),
          String(interval.endMs),
        ]);
        await acquireTransactionApplock(tx, legacyResource);
        await acquireTransactionApplock(tx, tenantResource);
      }
    },

    async assertFree(tx, _actor, input) {
      const { assertEmployeeIntervalAvailable } = await import('@/lib/scheduleIntegrity');
      await assertEmployeeIntervalAvailable({
        empId: input.employeeId,
        startAt: new Date(input.interval.startMs),
        endAt: new Date(input.interval.endMs),
        operationalDate: input.operationalDate,
        branchId: input.branchId,
        excludeBookingId: excludeBookingIdFromRefs(input.excludeRefs),
        excludeHoldKey: input.excludeHoldKey ?? null,
        transaction: tx,
      });
    },

    async lockAnyBarber(tx, _actor, input) {
      const legacyResource = `booking:any:${input.locationId}:${input.startMs}:${input.endMs}:${input.slotKey}`;
      const tenantResource = tenantLockResource(tenantId, [
        'loc',
        String(input.locationId),
        'any-barber',
        input.slotKey,
      ]);
      await acquireTransactionApplock(tx, legacyResource);
      await acquireTransactionApplock(tx, tenantResource);
    },

    async commit(_tx, _actor, _input) {
      /* Legacy path commits via booking/queue row writes in the same transaction. */
    },

    async release(_tx, _actor, _input) {
      /* Legacy path releases via status updates in booking/queue flows. */
    },
  };
}

export type { OccupancyPort };
