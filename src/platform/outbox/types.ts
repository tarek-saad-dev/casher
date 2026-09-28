export type OutboxStatus = 'pending' | 'delivering' | 'delivered' | 'dead';

export interface PlatformOutboxInsert {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: string;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  occurredAt?: Date;
}

export interface PlatformOutboxRow extends PlatformOutboxInsert {
  id: number;
  status: OutboxStatus;
  attempts: number;
  occurredAt: Date;
}
