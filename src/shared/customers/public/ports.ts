import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';

export interface CustomerSnapshot {
  customerId: number;
  phone: string | null;
  displayName: string | null;
}

export interface CustomersPort {
  upsertByPhone(
    tx: Transaction,
    actor: ActorContext,
    input: { phone: string; displayName?: string | null },
  ): Promise<number>;
  get(actor: ActorContext, customerId: number): Promise<CustomerSnapshot | null>;
  findByPhone(actor: ActorContext, phone: string): Promise<CustomerSnapshot | null>;
}
