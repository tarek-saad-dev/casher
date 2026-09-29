import 'server-only';
import type { ActorContext } from '@/platform/public';
import type { OperationalCalendarPort } from '@/shared/operational-calendar/public/ports';
import { createLegacyOperationalCalendarAdapter } from '@/shared/operational-calendar/public';
import { resolveBootstrapTenantId } from '@/lib/bookingSchedulingComposition';

export async function buildOperationalCalendarPort(
  actor: ActorContext,
): Promise<OperationalCalendarPort> {
  const tenantId = actor.tenantId ?? (await resolveBootstrapTenantId());
  return createLegacyOperationalCalendarAdapter(tenantId);
}
