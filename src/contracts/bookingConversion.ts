import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';

export interface BookingConversionLine {
  catalogItemId: number;
  employeeId: number | null;
  quantity: number;
  unitPrice: number;
  reservationDate: string;
}

/** Booking conversion port — interface owned by Booking; POS supplies the adapter. */
export interface BookingConversionPort {
  createServiceInvoice(
    tx: Transaction,
    actor: ActorContext,
    input: {
      tenantId: string;
      locationId: number;
      bookingId: number;
      clientId: number | null;
      userId: number;
      businessDayId: number;
      shiftInstanceId: number;
      businessDate: string;
      lines: BookingConversionLine[];
      paymentMethodId: number | null;
      notes: string | null;
      idempotencyKey: string;
    },
  ): Promise<{ legacyInvId: number; legacyInvType: string; invoiceId: string | null }>;
}
