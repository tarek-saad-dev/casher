import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingCustomerContact } from '@/lib/booking/bookingCustomerContact';

const sendStaffBookingPushMock = vi.fn();

vi.mock('@/lib/employee-portal/staffBookingPush', () => ({
  sendStaffBookingPush: (...args: unknown[]) => sendStaffBookingPushMock(...args),
}));

function contact(partial: Partial<BookingCustomerContact> = {}): BookingCustomerContact {
  return {
    bookingId: 100,
    bookingCode: 'BK-100',
    clientId: 5,
    customerName: 'محمد أحمد',
    phone: '01000000000',
    phoneSource: 'client_mobile',
    branchId: 1,
    branchName: 'CUT',
    empId: 7,
    empName: 'كريم',
    bookingDate: '2026-11-04',
    startTime: '18:30',
    servicesSummary: 'حلاقة، ذقن',
    ...partial,
  };
}

describe('notifyStaffOfOutboxBookingCreated', () => {
  beforeEach(() => {
    vi.resetModules();
    sendStaffBookingPushMock.mockReset();
    sendStaffBookingPushMock.mockResolvedValue({ scheduled: false, reason: 'sent_inline' });
  });

  it('skips non-created events without calling send', async () => {
    const { notifyStaffOfOutboxBookingCreated } = await import(
      '@/platform/outbox/staffBookingPushNotify'
    );
    const result = await notifyStaffOfOutboxBookingCreated({
      eventType: 'booking.cancelled',
      tenantId: 'tenant-1',
      contact: contact(),
    });
    expect(result).toEqual({ scheduled: false, reason: 'skipped_event' });
    expect(sendStaffBookingPushMock).not.toHaveBeenCalled();
  });

  it('skips when assigned emp is missing', async () => {
    const { notifyStaffOfOutboxBookingCreated } = await import(
      '@/platform/outbox/staffBookingPushNotify'
    );
    const result = await notifyStaffOfOutboxBookingCreated({
      eventType: 'booking.created',
      tenantId: 'tenant-1',
      contact: contact({ empId: null }),
    });
    expect(result).toEqual({ scheduled: false, reason: 'no_emp' });
    expect(sendStaffBookingPushMock).not.toHaveBeenCalled();
  });

  it('sends staff push for booking.created with tenant + masked-ready fields', async () => {
    const { notifyStaffOfOutboxBookingCreated, servicesListFromSummary } = await import(
      '@/platform/outbox/staffBookingPushNotify'
    );
    expect(servicesListFromSummary('حلاقة، ذقن')).toEqual(['حلاقة', 'ذقن']);

    const result = await notifyStaffOfOutboxBookingCreated({
      eventType: 'booking.created',
      tenantId: 'tenant-1',
      contact: contact(),
    });

    expect(result).toEqual({ scheduled: false, reason: 'sent_inline' });
    expect(sendStaffBookingPushMock).toHaveBeenCalledTimes(1);
    expect(sendStaffBookingPushMock).toHaveBeenCalledWith({
      assignedEmpId: 7,
      tenantId: 'tenant-1',
      bookingTime: '18:30',
      customerName: 'محمد أحمد',
      services: ['حلاقة', 'ذقن'],
      branchName: 'CUT',
    });
  });

  it('swallows send errors so outbox WhatsApp path stays independent', async () => {
    sendStaffBookingPushMock.mockRejectedValueOnce(new Error('push boom'));
    const { notifyStaffOfOutboxBookingCreated } = await import(
      '@/platform/outbox/staffBookingPushNotify'
    );
    const result = await notifyStaffOfOutboxBookingCreated({
      eventType: 'booking.created',
      tenantId: 'tenant-1',
      contact: contact(),
    });
    expect(result).toEqual({ scheduled: false, reason: 'no_subscriptions' });
  });
});
