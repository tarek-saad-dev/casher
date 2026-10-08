import 'server-only';
import type { ActorContext } from '@/platform/public';
import { publishPlatformOutboxEvent } from '@/platform/public';
import type { QueueSchedulingPorts } from '@/apps/queue/public/ports';
import { createQueuePortHooks } from '@/apps/queue/internal/queuePortAdapter';
import {
  createLegacyCustomersAdapter,
  createLegacyCatalogAdapter,
  createLegacyWorkforceOccupancyAdapter,
  createLegacyOperationalCalendarAdapter,
} from '@/legacy/index';
import { buildStaffActorContext } from '@/lib/bookingSchedulingComposition';
import { requireActorTenantId } from '@/platform/tenant/tenantContext';
import { assertTenantAppInstalled } from '@/platform/commercial/tenantAccessGate';

export type { QueuePortHooks } from '@/apps/queue/internal/queuePortAdapter';

export async function buildQueueSchedulingPorts(
  actor: ActorContext,
): Promise<QueueSchedulingPorts> {
  const tenantId = requireActorTenantId(actor, 'buildQueueSchedulingPorts');
  await assertTenantAppInstalled(tenantId, 'queue');
  return {
    tenantId,
    actor: { ...actor, tenantId },
    customers: createLegacyCustomersAdapter(),
    catalog: createLegacyCatalogAdapter(),
    occupancy: createLegacyWorkforceOccupancyAdapter(tenantId),
    calendar: createLegacyOperationalCalendarAdapter(tenantId),
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

export async function buildQueuePortHooksForActor(
  actor: ActorContext,
): Promise<ReturnType<typeof createQueuePortHooks>> {
  const deps = await buildQueueSchedulingPorts(actor);
  return createQueuePortHooks(deps);
}

export { buildStaffActorContext };
