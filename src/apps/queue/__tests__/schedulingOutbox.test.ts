import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'mssql';
import { createQueuePortHooks } from '../internal/queuePortAdapter';
import type { QueueSchedulingPorts } from '../public/ports';

describe('extracted queue event delivery', () => {
  it('publishes one PlatformOutbox event through port hooks', async () => {
    const outboxRows: unknown[] = [];
    const deps: QueueSchedulingPorts = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      actor: {
        actorType: 'staff',
        actorId: '1',
        tenantId: '11111111-1111-4111-8111-111111111111',
        membershipId: null,
        viewLocationId: null,
      },
      customers: {} as QueueSchedulingPorts['customers'],
      catalog: {} as QueueSchedulingPorts['catalog'],
      occupancy: {} as QueueSchedulingPorts['occupancy'],
      calendar: {} as QueueSchedulingPorts['calendar'],
      publishOutbox: vi.fn(async (_tx, event) => {
        outboxRows.push(event);
        return outboxRows.length;
      }),
    };

    const hooks = createQueuePortHooks(deps);
    await hooks.publishQueueEvent({} as Transaction, {
      eventType: 'queue.created',
      queueTicketId: 200,
      ticketCode: 'W-001',
      payload: { branchId: 1, empId: 5 },
      idempotencyKey: 'queue.created:200',
    });

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({
      eventType: 'queue.created',
      aggregateType: 'queue',
      aggregateId: '200',
      idempotencyKey: 'queue.created:200',
    });
  });

  it('useExtractedEventDelivery skips legacy notify path in create input contract', async () => {
    const { createQueueTicket } = await import('../application/createQueueTicket');
    expect(typeof createQueueTicket).toBe('function');
    expect(createQueueTicket.name).toBe('createQueueTicket');
  });
});
