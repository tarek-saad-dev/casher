import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import type { CatalogPort } from '@/shared/catalog/public/ports';
import type { CustomersPort } from '@/shared/customers/public/ports';
import type { OperationalCalendarPort } from '@/shared/operational-calendar/public/ports';
import type { OccupancyPort } from '@/shared/workforce/public/ports';
import type { BookingConversionPort } from '@/contracts/bookingConversion';

export type { BookingConversionPort, BookingConversionLine } from '@/contracts/bookingConversion';

export interface BookingSchedulingPorts {
  tenantId: string;
  actor: ActorContext;
  customers: CustomersPort;
  catalog: CatalogPort;
  occupancy: OccupancyPort;
  calendar: OperationalCalendarPort;
  conversion: BookingConversionPort;
  publishOutbox: (
    tx: Transaction,
    event: {
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: string;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) => Promise<number>;
}
