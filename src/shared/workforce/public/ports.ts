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
