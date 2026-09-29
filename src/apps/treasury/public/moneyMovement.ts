import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';

export type MoneyDirection = 'in' | 'out';

export interface PostCommand {
  tenantId: string;
  locationId: number;
  businessDayId: number;
  /** Calendar date for invDate; defaults to TblNewDay.NewDay for businessDayId. */
  businessDate?: string | null;
  shiftInstanceId: number | null;
  amount: number;
  direction: MoneyDirection;
  reason: string;
  sourceRef: string;
  paymentMethodId: number | null;
  idempotencyKey: string;
  /** Legacy ExpINID category — required for income/expense, optional for transfer legs. */
  categoryId?: number | null;
  notes?: string | null;
  clientId?: number | null;
  invTime?: string | null;
  /** Links atomic transfer out/in pair under one stable scope. */
  transferGroupKey?: string | null;
  /** Explicit legacy invType when reason alone is ambiguous. */
  invType?: 'income' | 'expense';
}

export interface ReverseCommand {
  tenantId: string;
  originalIdempotencyKey: string;
  idempotencyKey: string;
  reason: string;
}

export interface MoneyMovementPort {
  post(tx: Transaction, actor: ActorContext, command: PostCommand): Promise<number>;
  reverse(tx: Transaction, actor: ActorContext, command: ReverseCommand): Promise<number>;
}

/**
 * DRVO-003: POS sale create still relies on InsCashMoveSales trigger.
 * This port documents the Treasury boundary; sale create must NOT also call post().
 */
