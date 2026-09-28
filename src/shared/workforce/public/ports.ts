import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';

export type OccupancySource = 'booking' | 'queue';

export interface TimeInterval {
  startMs: number;
  endMs: number;
}

export interface OccupancyPort {
  lock(
    tx: Transaction,
    actor: ActorContext,
    input: { employeeId: number; intervals: TimeInterval[] },
  ): Promise<void>;
  assertFree(
    tx: Transaction,
    actor: ActorContext,
    input: {
      employeeId: number;
      interval: TimeInterval;
      excludeRefs?: string[];
      /** Business date of the requested interval. Occupancy is not "today" by default. */
      operationalDate?: string;
      /** Requested location. Conflict scope stays tenant-global for the employee. */
      branchId?: number | null;
      /** Customer's own hold must not block create. */
      excludeHoldKey?: string | null;
    },
  ): Promise<void>;
  /**
   * Any-barber assignment lock. Lives on the occupancy port so Booking does not
   * take its own applock (DRVO-002 D6).
   */
  lockAnyBarber(
    tx: Transaction,
    actor: ActorContext,
    input: {
      locationId: number;
      startMs: number;
      endMs: number;
      slotKey: string;
    },
  ): Promise<void>;
  commit(
    tx: Transaction,
    actor: ActorContext,
    input: {
      employeeId: number;
      interval: TimeInterval;
      ref: string;
      locationId: number;
      source: OccupancySource;
    },
  ): Promise<void>;
  release(tx: Transaction, actor: ActorContext, input: { ref: string }): Promise<void>;
}
