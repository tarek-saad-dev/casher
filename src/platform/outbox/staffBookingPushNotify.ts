import 'server-only';

import type { BookingCustomerContact } from '@/lib/booking/bookingCustomerContact';
import {
  sendStaffBookingPush,
  type StaffBookingPushResult,
} from '@/lib/employee-portal/staffBookingPush';

/** Split BookingServices STRING_AGG summary into discrete service names. */
export function servicesListFromSummary(summary: string | null | undefined): string[] {
  return String(summary ?? '')
    .split(/[،,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Best-effort CUT STAFF Web Push for extracted booking.created outbox delivery.
 * Never throws — WhatsApp/outbox success must not depend on push.
 */
export async function notifyStaffOfOutboxBookingCreated(input: {
  eventType: string;
  tenantId: string;
  contact: BookingCustomerContact;
}): Promise<StaffBookingPushResult | { scheduled: false; reason: 'skipped_event' | 'no_emp' }> {
  if (input.eventType !== 'booking.created') {
    return { scheduled: false, reason: 'skipped_event' };
  }
  const empId = input.contact.empId;
  if (!Number.isSafeInteger(empId) || !empId || empId <= 0) {
    return { scheduled: false, reason: 'no_emp' };
  }

  try {
    return await sendStaffBookingPush({
      assignedEmpId: empId,
      tenantId: input.tenantId,
      bookingTime: input.contact.startTime ?? '',
      customerName: input.contact.customerName ?? 'عميل',
      services: servicesListFromSummary(input.contact.servicesSummary),
      branchName: input.contact.branchName ?? undefined,
    });
  } catch (error) {
    console.error(
      '[platform-outbox] staff push failed',
      error instanceof Error ? error.message : error,
    );
    return { scheduled: false, reason: 'no_subscriptions' };
  }
}
