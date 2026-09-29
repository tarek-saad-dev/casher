import type { ActorContext } from '@/platform/public';
import type { OperationalCalendarPort } from '@/shared/operational-calendar/public/ports';

/** Dependency injection for POS sale commands (LEVEL 1 boundary). */
export type PosPorts = {
  tenantId: string;
  actor: ActorContext;
  calendar: OperationalCalendarPort;
};
