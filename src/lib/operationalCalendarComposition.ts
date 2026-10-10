import 'server-only';
import type { ActorContext } from '@/platform/public';
import type { OperationalCalendarPort } from '@/shared/operational-calendar/public/ports';
import { createLegacyOperationalCalendarAdapter } from '@/shared/operational-calendar/public';
import { requireActorTenantId } from '@/platform/tenant/tenantContext';

export async function buildOperationalCalendarPort(
  actor: ActorContext,
): Promise<OperationalCalendarPort> {
  const tenantId = requireActorTenantId(actor, 'buildOperationalCalendarPort');
  return createLegacyOperationalCalendarAdapter(tenantId);
}
