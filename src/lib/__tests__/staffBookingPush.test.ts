import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const deleteEndpointMock = vi.fn();
const scheduleMock = vi.fn();
const sendNotificationMock = vi.fn();
const setVapidDetailsMock = vi.fn();

vi.mock('@/lib/employee-portal/pushSubscriptions', () => ({
  listPortalPushSubscriptionsForEmployee: (...args: unknown[]) => listMock(...args),
  deletePortalPushSubscriptionByEndpoint: (...args: unknown[]) => deleteEndpointMock(...args),
}));

vi.mock('@/lib/schedulePostResponse', () => ({
  schedulePostResponse: (task: () => Promise<void>) => scheduleMock(task),
}));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetailsMock(...args),
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  },
}));

describe('staffBookingPush', () => {
  beforeEach(() => {
    vi.resetModules();
    listMock.mockReset();
    deleteEndpointMock.mockReset();
    scheduleMock.mockClear();
    sendNotificationMock.mockReset();
    setVapidDetailsMock.mockReset();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_CONTACT;
    delete process.env.VAPID_SUBJECT;
  });

  it('skips when suppressNotification is true', async () => {
    const { scheduleStaffBookingPush, sendStaffBookingPush } = await import(
      '@/lib/employee-portal/staffBookingPush'
    );
    expect(
      scheduleStaffBookingPush({
        assignedEmpId: 7,
        bookingTime: '11:00',
        customerName: 'محمد أحمد',
        suppressNotification: true,
      }),
    ).toEqual({ scheduled: false, reason: 'suppressed' });
    expect(
      await sendStaffBookingPush({
        assignedEmpId: 7,
        bookingTime: '11:00',
        customerName: 'محمد أحمد',
        suppressNotification: true,
      }),
    ).toEqual({ scheduled: false, reason: 'suppressed' });
    expect(scheduleMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('skips when VAPID is not configured', async () => {
    const { scheduleStaffBookingPush } = await import('@/lib/employee-portal/staffBookingPush');
    expect(
      scheduleStaffBookingPush({
        assignedEmpId: 7,
        bookingTime: '11:00',
        customerName: 'محمد أحمد',
      }),
    ).toEqual({ scheduled: false, reason: 'no_vapid' });
  });

  it('skips send when employee has no subscriptions', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.VAPID_CONTACT = 'mailto:ops@example.com';
    listMock.mockResolvedValueOnce([]);
    const { sendStaffBookingPush } = await import('@/lib/employee-portal/staffBookingPush');
    expect(
      await sendStaffBookingPush({
        assignedEmpId: 7,
        bookingTime: '11:00',
        customerName: 'محمد أحمد',
        services: ['حلاقة'],
      }),
    ).toEqual({ scheduled: false, reason: 'no_subscriptions' });
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('sends masked payload and removes gone endpoints', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.VAPID_CONTACT = 'mailto:ops@example.com';
    listMock.mockResolvedValueOnce([
      {
        ID: 1,
        EmpID: 7,
        TenantId: 't1',
        Endpoint: 'https://push.example/gone',
        P256dh: 'k1',
        Auth: 'a1',
      },
      {
        ID: 2,
        EmpID: 7,
        TenantId: 't1',
        Endpoint: 'https://push.example/ok',
        P256dh: 'k2',
        Auth: 'a2',
      },
    ]);
    sendNotificationMock
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
      .mockResolvedValueOnce({});

    const { sendStaffBookingPush } = await import('@/lib/employee-portal/staffBookingPush');
    const result = await sendStaffBookingPush({
      assignedEmpId: 7,
      bookingTime: '11:30',
      customerName: 'محمد أحمد علي',
      services: ['حلاقة', 'ذقن'],
      branchName: 'CUT',
    });

    expect(result).toEqual({ scheduled: false, reason: 'sent_inline' });
    expect(setVapidDetailsMock).toHaveBeenCalled();
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(String(sendNotificationMock.mock.calls[1][1]));
    expect(payload.title).toBe('حجز جديد لك');
    expect(payload.body).toContain('محمد');
    expect(payload.body).not.toContain('أحمد');
    expect(payload.body).not.toMatch(/\d{8,}/);
    expect(payload.url).toBe('/employee-portal/bookings');
    expect(deleteEndpointMock).toHaveBeenCalledWith('https://push.example/gone');
  });

  it('schedules post-response work when configured', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.VAPID_CONTACT = 'mailto:ops@example.com';
    listMock.mockResolvedValueOnce([]);
    const { scheduleStaffBookingPush } = await import('@/lib/employee-portal/staffBookingPush');
    expect(
      scheduleStaffBookingPush({
        assignedEmpId: 9,
        bookingTime: '12:00',
        customerName: 'Sara Ali',
      }),
    ).toEqual({ scheduled: true });
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });
});
