import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'mssql';
import { bridgeAssertEmployeeFree } from '@/lib/booking/schedulingPortLegacyBridge';
import type { SchedulingPortHooks } from '../internal/schedulingPortAdapter';

describe('cross-location employee conflict via Workforce occupancy port', () => {
  it('fails closed when occupancy port reports conflict', async () => {
    const hooks: SchedulingPortHooks = {
      upsertCustomer: vi.fn(),
      assertEmployeeFree: vi.fn(async () => {
        throw new Error('WORKFORCE_OCCUPANCY_CONFLICT');
      }),
      acquireEmpIntervalLock: vi.fn(),
      acquireAnyBarberLock: vi.fn(),
      commitOccupancy: vi.fn(),
      releaseOccupancy: vi.fn(),
      publishSchedulingEvent: vi.fn(),
      catalog: {} as SchedulingPortHooks['catalog'],
      calendar: {} as SchedulingPortHooks['calendar'],
      conversion: {} as SchedulingPortHooks['conversion'],
      tenantId: '11111111-1111-4111-8111-111111111111',
      actor: {
        actorType: 'staff',
        actorId: '1',
        tenantId: '11111111-1111-4111-8111-111111111111',
        membershipId: 'm1',
        viewLocationId: null,
      },
    };

    await expect(
      bridgeAssertEmployeeFree(
        { schedulingPortHooks: hooks },
        {} as Transaction,
        {
          employeeId: 5,
          startMs: Date.parse('2026-09-28T10:00:00+03:00'),
          endMs: Date.parse('2026-09-28T11:00:00+03:00'),
          branchId: 2,
        },
      ),
    ).rejects.toThrow('WORKFORCE_OCCUPANCY_CONFLICT');

    expect(hooks.assertEmployeeFree).toHaveBeenCalledOnce();
  });
});
