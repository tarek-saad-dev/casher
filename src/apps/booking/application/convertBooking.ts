import 'server-only';
import type { BookingSchedulingPorts } from '../public/ports';
import {
  loadBookingForConversion,
  markBookingConverted,
} from '../internal/bookingRepository';
import { withUnitOfWork } from '@/platform/public';

export type ConvertBookingInput = {
  bookingId: number;
  locationId: number;
  userId: number;
  paymentMethodId?: number | null;
  notes?: string | null;
  idempotencyKey?: string;
};

export type ConvertBookingResult =
  | { ok: true; invoiceId: number; invoiceType: string; idempotentReplay: boolean }
  | { ok: false; status: number; error: string };

export async function convertBooking(
  deps: BookingSchedulingPorts,
  input: ConvertBookingInput,
): Promise<ConvertBookingResult> {
  const idempotencyKey = input.idempotencyKey ?? `booking:${input.bookingId}`;

  return withUnitOfWork(async ({ transaction }) => {
    const loaded = await loadBookingForConversion(transaction, input.bookingId);
    if (!loaded) {
      return { ok: false as const, status: 404, error: 'حجز غير موجود' };
    }

    const { booking, services } = loaded;

    if (booking.branchId !== input.locationId) {
      return { ok: false as const, status: 404, error: 'حجز غير موجود' };
    }

    if (booking.convertedInvId) {
      return {
        ok: true as const,
        invoiceId: booking.convertedInvId,
        invoiceType: booking.convertedInvType ?? 'خدمة',
        idempotentReplay: true,
      };
    }

    if (!services.length) {
      return { ok: false as const, status: 400, error: 'لا توجد خدمات لتحويلها' };
    }

    const financial = await deps.calendar.resolveFinancialWriteContext(
      transaction,
      deps.actor,
      { locationId: input.locationId },
    );

    if (financial.scope !== 'SHIFT' || financial.shiftInstanceId == null) {
      return { ok: false as const, status: 400, error: 'لا يوجد وردية مفتوحة' };
    }

    const invoice = await deps.conversion.createServiceInvoice(transaction, deps.actor, {
      tenantId: deps.tenantId,
      locationId: input.locationId,
      bookingId: input.bookingId,
      clientId: booking.clientId,
      userId: input.userId,
      businessDayId: financial.businessDayId,
      shiftInstanceId: financial.shiftInstanceId,
      businessDate: financial.businessDate,
      paymentMethodId: input.paymentMethodId ?? null,
      notes: input.notes ?? null,
      idempotencyKey,
      lines: services.map((svc) => ({
        catalogItemId: svc.proId,
        employeeId: svc.empId ?? booking.assignedEmpId,
        quantity: svc.qty,
        unitPrice: svc.price,
        reservationDate: svc.reservationDate,
      })),
    });

    await markBookingConverted(transaction, {
      bookingId: input.bookingId,
      legacyInvId: invoice.legacyInvId,
      legacyInvType: invoice.legacyInvType,
    });

    await deps.publishOutbox(transaction, {
      aggregateType: 'booking',
      aggregateId: String(input.bookingId),
      eventType: 'booking.completed',
      payload: JSON.stringify({
        tenantId: deps.tenantId,
        bookingId: input.bookingId,
        bookingCode: booking.bookingCode,
        invoiceId: invoice.legacyInvId,
        invoiceType: invoice.legacyInvType,
      }),
      idempotencyKey: `booking.completed:${idempotencyKey}`,
      correlationId: booking.bookingCode ?? String(input.bookingId),
    });

    return {
      ok: true as const,
      invoiceId: invoice.legacyInvId,
      invoiceType: invoice.legacyInvType,
      idempotentReplay: false,
    };
  });
}
