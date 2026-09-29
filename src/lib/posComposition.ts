import 'server-only';
import type { ActorContext } from '@/platform/public';
import type { PosPorts } from '@/apps/pos/public/ports';
import { buildOperationalCalendarPort } from '@/lib/operationalCalendarComposition';
import {
  buildStaffActorContext,
  resolveBootstrapTenantId,
} from '@/lib/bookingSchedulingComposition';

export async function buildPosPorts(actor: ActorContext): Promise<PosPorts> {
  const tenantId = actor.tenantId ?? (await resolveBootstrapTenantId());
  return {
    tenantId,
    actor: { ...actor, tenantId },
    calendar: await buildOperationalCalendarPort(actor),
  };
}

export async function buildPosPortsForStaffUser(userId: number): Promise<PosPorts> {
  const actor = await buildStaffActorContext(userId);
  return buildPosPorts(actor);
}

export { buildStaffActorContext, resolveBootstrapTenantId };
