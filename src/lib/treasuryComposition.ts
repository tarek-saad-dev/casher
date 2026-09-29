import 'server-only';
import type { ActorContext } from '@/platform/public';
import type { MoneyMovementPort } from '@/apps/treasury/public/moneyMovement';
import type { OperationalCalendarPort } from '@/shared/operational-calendar/public/ports';
import { createLegacyMoneyMovementAdapter } from '@/apps/treasury/public';
import { buildOperationalCalendarPort } from '@/lib/operationalCalendarComposition';
import { resolveBootstrapTenantId } from '@/lib/bookingSchedulingComposition';

export type TreasuryWritePorts = {
  tenantId: string;
  actor: ActorContext;
  calendar: OperationalCalendarPort;
  moneyMovement: MoneyMovementPort;
};

export async function buildTreasuryWritePorts(actor: ActorContext): Promise<TreasuryWritePorts> {
  const tenantId = actor.tenantId ?? (await resolveBootstrapTenantId());
  return {
    tenantId,
    actor: { ...actor, tenantId },
    calendar: await buildOperationalCalendarPort({ ...actor, tenantId }),
    moneyMovement: createLegacyMoneyMovementAdapter(),
  };
}
