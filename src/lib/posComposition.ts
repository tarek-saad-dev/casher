import 'server-only';
import type { ActorContext } from '@/platform/public';
import type { PosPorts } from '@/apps/pos/public/ports';
import { buildOperationalCalendarPort } from '@/lib/operationalCalendarComposition';
import { buildStaffActorContext } from '@/lib/bookingSchedulingComposition';
import { requireActorTenantId } from '@/platform/tenant/tenantContext';
import { assertTenantAppInstalled } from '@/platform/commercial/tenantAccessGate';

export async function buildPosPorts(actor: ActorContext): Promise<PosPorts> {
  const tenantId = requireActorTenantId(actor, 'buildPosPorts');
  await assertTenantAppInstalled(tenantId, 'pos');
  return {
    tenantId,
    actor: { ...actor, tenantId },
    calendar: await buildOperationalCalendarPort({ ...actor, tenantId }),
  };
}

export async function buildPosPortsForStaffUser(
  userId: number,
  sessionTenantId?: string | null,
): Promise<PosPorts> {
  const actor = await buildStaffActorContext(userId, sessionTenantId);
  return buildPosPorts(actor);
}

export { buildStaffActorContext };
