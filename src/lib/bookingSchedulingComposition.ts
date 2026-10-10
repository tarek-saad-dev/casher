import 'server-only';
import type { ActorContext } from '@/platform/public';
import { publishPlatformOutboxEvent } from '@/platform/public';
import type { BookingSchedulingPorts } from '@/apps/booking/public/ports';
import { createSchedulingPortHooks } from '@/apps/booking/internal/schedulingPortAdapter';
import {
  createLegacyCustomersAdapter,
  createLegacyCatalogAdapter,
  createLegacyWorkforceOccupancyAdapter,
  createLegacyOperationalCalendarAdapter,
} from '@/legacy/index';
import { createLegacyBookingConversionAdapter } from '@/apps/pos/internal/legacyBookingConversionAdapter';
import { resolveUserTenantMembership, requireActorTenantId } from '@/platform/tenant/tenantContext';
import { assertTenantAppInstalled } from '@/platform/commercial/tenantAccessGate';

export type { SchedulingPortHooks } from '@/apps/booking/internal/schedulingPortAdapter';

/**
 * Staff actor with an authoritative tenant. `sessionTenantId` is the signed session claim and
 * must match one of the user's memberships; without it the user must have exactly one membership.
 * Throws TenantContextError instead of defaulting to any tenant.
 */
export async function buildStaffActorContext(
  userId: number,
  sessionTenantId?: string | null,
): Promise<ActorContext> {
  const tenant = await resolveUserTenantMembership({
    userId,
    preferredTenantId: sessionTenantId ?? null,
  });
  return {
    actorType: 'staff',
    actorId: String(userId),
    tenantId: tenant.tenantId,
    membershipId: tenant.membershipId,
    viewLocationId: null,
  };
}

export async function buildCustomerActorContext(tenantId: string): Promise<ActorContext> {
  return {
    actorType: 'customer',
    actorId: 'anonymous',
    tenantId: requireActorTenantId({ tenantId }, 'buildCustomerActorContext'),
    membershipId: null,
    viewLocationId: null,
  };
}

export async function buildBookingSchedulingPorts(
  actor: ActorContext,
): Promise<BookingSchedulingPorts> {
  const tenantId = requireActorTenantId(actor, 'buildBookingSchedulingPorts');
  await assertTenantAppInstalled(tenantId, 'booking');
  return {
    tenantId,
    actor: { ...actor, tenantId },
    customers: createLegacyCustomersAdapter(),
    catalog: createLegacyCatalogAdapter(),
    occupancy: createLegacyWorkforceOccupancyAdapter(tenantId),
    calendar: createLegacyOperationalCalendarAdapter(tenantId),
    conversion: createLegacyBookingConversionAdapter(),
    publishOutbox: async (tx, event) =>
      publishPlatformOutboxEvent(tx, {
        tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload,
        idempotencyKey: event.idempotencyKey,
        correlationId: event.correlationId,
      }),
  };
}

export async function buildSchedulingPortHooksForActor(
  actor: ActorContext,
): Promise<ReturnType<typeof createSchedulingPortHooks>> {
  const deps = await buildBookingSchedulingPorts(actor);
  return createSchedulingPortHooks(deps);
}
