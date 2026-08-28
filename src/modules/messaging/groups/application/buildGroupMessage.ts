import { renderTemplate } from '@/modules/messaging/templates/renderTemplate';
import type { WhatsAppGroupEventKey } from '../domain/types';
import {
  BOOKING_CANCELLED_TEAM_DEFAULT_TEMPLATE,
  BOOKING_MOVED_TEAM_DEFAULT_TEMPLATE,
  BOOKING_TEAM_NOTIFICATION_DEFAULT_TEMPLATE,
  SALE_TEAM_DEFAULT_TEMPLATE,
} from '../domain/defaultTemplates';

export type BookingGroupMessageInput = {
  customerName: string;
  bookingId: number;
  bookingDate: string;
  bookingTime: string;
  barberName?: string;
  services?: string[];
  branchName?: string;
};

export type SaleGroupMessageInput = {
  customerName: string;
  invoiceNumber: string;
  total: number;
  branchName?: string;
};

function formatServices(services?: string[]): string {
  if (!services?.length) return '—';
  return services.join('، ');
}

function formatBarber(name?: string): string {
  return name?.trim() || '—';
}

export function buildGroupMessageForEvent(
  eventKey: WhatsAppGroupEventKey,
  variables: BookingGroupMessageInput | SaleGroupMessageInput,
): string {
  switch (eventKey) {
    case 'booking.created':
      return renderTemplate(BOOKING_TEAM_NOTIFICATION_DEFAULT_TEMPLATE, {
        customerName: (variables as BookingGroupMessageInput).customerName,
        bookingDate: (variables as BookingGroupMessageInput).bookingDate,
        bookingTime: (variables as BookingGroupMessageInput).bookingTime,
        barberName: formatBarber((variables as BookingGroupMessageInput).barberName),
        services: formatServices((variables as BookingGroupMessageInput).services),
        branchName: (variables as BookingGroupMessageInput).branchName ?? '—',
        bookingId: `BK-${(variables as BookingGroupMessageInput).bookingId}`,
      });
    case 'booking.cancelled':
      return renderTemplate(BOOKING_CANCELLED_TEAM_DEFAULT_TEMPLATE, {
        customerName: (variables as BookingGroupMessageInput).customerName,
        bookingDate: (variables as BookingGroupMessageInput).bookingDate,
        bookingTime: (variables as BookingGroupMessageInput).bookingTime,
        barberName: formatBarber((variables as BookingGroupMessageInput).barberName),
        branchName: (variables as BookingGroupMessageInput).branchName ?? '—',
        bookingId: `BK-${(variables as BookingGroupMessageInput).bookingId}`,
      });
    case 'booking.moved':
      return renderTemplate(BOOKING_MOVED_TEAM_DEFAULT_TEMPLATE, {
        customerName: (variables as BookingGroupMessageInput).customerName,
        bookingDate: (variables as BookingGroupMessageInput).bookingDate,
        bookingTime: (variables as BookingGroupMessageInput).bookingTime,
        barberName: formatBarber((variables as BookingGroupMessageInput).barberName),
        branchName: (variables as BookingGroupMessageInput).branchName ?? '—',
        bookingId: `BK-${(variables as BookingGroupMessageInput).bookingId}`,
      });
    case 'sale.completed':
      return renderTemplate(SALE_TEAM_DEFAULT_TEMPLATE, {
        customerName: (variables as SaleGroupMessageInput).customerName,
        invoiceNumber: (variables as SaleGroupMessageInput).invoiceNumber,
        total: String((variables as SaleGroupMessageInput).total),
        branchName: (variables as SaleGroupMessageInput).branchName ?? '—',
      });
    default:
      return '';
  }
}
