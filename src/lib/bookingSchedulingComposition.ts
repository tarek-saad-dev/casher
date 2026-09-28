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
import { resolveStaffTenantContext } from '@/platform/session/staffTenantContext';
import { getPool, sql } from '@/lib/db';
import { BOOTSTRAP_TENANT_CODE } from '@/platform/tenant/types';

export type { SchedulingPortHooks } from '@/apps/booking/internal/schedulingPortAdapter';

let cachedBootstrapTenantId: string | null = null;

export async function resolveBootstrapTenantId(): Promise<string> {
  if (cachedBootstrapTenantId) return cachedBootstrapTenantId;
  const db = await getPool();
  const result = await db
    .request()
    .input('code', sql.NVarChar, BOOTSTRAP_TENANT_CODE)
    .query(`
      SELECT TenantId FROM dbo.Tenant WHERE Code = @code AND Status = N'active'
    `);
  const tenantId = result.recordset[0]?.TenantId;
  if (!tenantId) {
    throw new Error('BOOTSTRAP_TENANT_NOT_FOUND');
  }
  cachedBootstrapTenantId = String(tenantId);
  return cachedBootstrapTenantId;
}

export async function buildStaffActorContext(userId: number): Promise<ActorContext> {
  const tenant = await resolveStaffTenantContext({ UserID: userId });
  if (tenant) {
    return {
      actorType: 'staff',
      actorId: String(userId),
      tenantId: tenant.tenantId,
      membershipId: tenant.membershipId,
      viewLocationId: null,
    };
  }
  const tenantId = await resolveBootstrapTenantId();
  return {
    actorType: 'staff',
    actorId: String(userId),
    tenantId,
    membershipId: null,
    viewLocationId: null,
  };
}

export async function buildCustomerActorContext(tenantId: string): Promise<ActorContext> {
  return {
    actorType: 'customer',
    actorId: 'anonymous',
    tenantId,
    membershipId: null,
    viewLocationId: null,
  };
}

export async function buildBookingSchedulingPorts(
  actor: ActorContext,
): Promise<BookingSchedulingPorts> {
  const tenantId = actor.tenantId ?? (await resolveBootstrapTenantId());
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
