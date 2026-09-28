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
        const resource = tenantLockResource(tenantId, [
          'emp',
          String(input.employeeId),
          String(interval.startMs),
          String(interval.endMs),
        ]);
        await acquireTransactionApplock(tx, resource);
      }
    },

    async assertFree(tx, _actor, input) {
      const { assertEmployeeIntervalAvailable } = await import('@/lib/scheduleIntegrity');
      await assertEmployeeIntervalAvailable({
        empId: input.employeeId,
        startMs: input.interval.startMs,
        endMs: input.interval.endMs,
        transaction: tx,
      });
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
