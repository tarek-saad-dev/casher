/**
 * Team-facing WhatsApp group notifications for booking lifecycle events.
 */
import { scheduleWhatsAppGroupNotifications } from '@/modules/messaging/groups';

export type BookingTeamGroupNotifyInput = {
  eventKey: 'booking.created' | 'booking.cancelled' | 'booking.moved';
  bookingId: number;
  customerName: string;
  bookingDate: string;
  bookingTime: string;
  barberName?: string;
  services?: string[];
  branchName?: string;
  branchId?: number;
};

export function scheduleBookingTeamGroupNotify(
  input: BookingTeamGroupNotifyInput,
): { scheduled: true } {
  return scheduleWhatsAppGroupNotifications({
    eventKey: input.eventKey,
    branchId: input.branchId,
    variables: {
      customerName: input.customerName,
      bookingId: input.bookingId,
      bookingDate: input.bookingDate,
      bookingTime: input.bookingTime,
      barberName: input.barberName,
      services: input.services,
      branchName: input.branchName,
    },
  });
}
