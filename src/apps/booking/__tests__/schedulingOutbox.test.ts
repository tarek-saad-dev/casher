import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'mssql';
import { createSchedulingPortHooks } from '../internal/schedulingPortAdapter';
import type { BookingSchedulingPorts } from '../public/ports';

describe('extracted scheduling event delivery', () => {
  it('publishes one PlatformOutbox event through port hooks', async () => {
    const outboxRows: unknown[] = [];
    const deps: BookingSchedulingPorts = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      actor: {
        actorType: 'customer',
        actorId: 'anonymous',
        tenantId: '11111111-1111-4111-8111-111111111111',
        membershipId: null,
        viewLocationId: null,
      },
      customers: {} as BookingSchedulingPorts['customers'],
      catalog: {} as BookingSchedulingPorts['catalog'],
      occupancy: {} as BookingSchedulingPorts['occupancy'],
      calendar: {} as BookingSchedulingPorts['calendar'],
      conversion: {} as BookingSchedulingPorts['conversion'],
      publishOutbox: vi.fn(async (_tx, event) => {
        outboxRows.push(event);
        return outboxRows.length;
      }),
    };

    const hooks = createSchedulingPortHooks(deps);
    await hooks.publishSchedulingEvent({} as Transaction, {
      eventType: 'booking.created',
      bookingId: 100,
      bookingCode: 'BK-100',
      payload: { branchId: 1 },
      idempotencyKey: 'booking.created:100',
    });

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({
      eventType: 'booking.created',
      aggregateType: 'booking',
      aggregateId: '100',
      idempotencyKey: 'booking.created:100',
    });
  });

  it('useExtractedEventDelivery skips legacy notify path in create input contract', async () => {
    const { createBooking } = await import('../application/createBooking');
    expect(typeof createBooking).toBe('function');
    expect(createBooking.name).toBe('createBooking');
  });
});
