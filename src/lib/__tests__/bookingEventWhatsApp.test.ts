/**
 * WhatsApp move/cancel idempotency + retry — unit tests (mocked DB/send).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const queryMock = vi.fn();
const inputMock = vi.fn(() => ({ input: inputMock, query: queryMock }));

vi.mock('@/lib/db', () => ({
  getPool: async () => ({
    request: () => ({ input: inputMock, query: queryMock }),
  }),
  sql: {
    NVarChar: (n?: number) => n,
    Int: 'Int',
    BigInt: 'BigInt',
    Date: 'Date',
    MAX: 'MAX',
  },
}));

vi.mock('@/lib/availability/bookingAvailabilityMetrics', () => ({
  logBookingAvailabilityMetric: vi.fn(),
}));

const scheduleAfterCommit = vi.fn(
  (..._args: unknown[]) => ({ scheduled: true, mechanism: 'after' }),
);
vi.mock('@/lib/bookingPostCommitNotification', () => ({
  scheduleBookingWhatsAppAfterCommit: (input: unknown, deps?: unknown) =>
    scheduleAfterCommit(input, deps),
}));

vi.mock('@/lib/booking/bookingCustomerContact', () => ({
  loadBookingCustomerContact: vi.fn(async (bookingId: number) => ({
    bookingId,
    bookingCode: `BK-${bookingId}`,
    clientId: 1,
    customerName: 'عميل',
    phone: '201012345678',
    phoneSource: 'client_mobile',
    branchId: 1,
    branchName: 'فرع',
    empId: 9,
    empName: 'حلاق',
    bookingDate: '2026-08-17',
    startTime: '15:00',
    servicesSummary: 'قص',
  })),
}));

vi.mock('@/lib/publicBookingHelpers', () => ({
  isUsableCustomerPhone: (p: string | null | undefined) =>
    Boolean(p && String(p).replace(/\D/g, '').length >= 10),
  normalizePublicBookingPhone: (p: string) => p.replace(/\D/g, ''),
}));

describe('bookingEventWhatsApp', () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    inputMock.mockClear();
    scheduleAfterCommit.mockClear();
    // ensure table + insert success by default
    queryMock.mockResolvedValue({ recordset: [{ Len: 1 }] });
  });

  it('move queues one message and schedules send', async () => {
    queryMock
      .mockResolvedValueOnce({ recordset: [] }) // ensure table DDL
      .mockResolvedValueOnce({ recordset: [] }) // insert
      .mockResolvedValueOnce({ recordset: [] }); // status → sending

    const { scheduleBookingEventWhatsApp } = await import(
      '@/lib/booking/bookingEventWhatsApp'
    );
    const r = await scheduleBookingEventWhatsApp({
      bookingId: 42,
      bookingCode: 'BK-42',
      eventType: 'move',
      eventVersion: 'v1',
      phone: '201012345678',
      customerName: 'عميل',
      bookingDate: '2026-08-17',
      bookingTime: '15:00',
      barberName: 'حلاق',
      branchName: 'فرع',
    });
    expect(r.scheduled).toBe(true);
    expect(r.idempotencyKey).toBe('wa:move:42:v1');
    expect(scheduleAfterCommit).toHaveBeenCalledTimes(1);
  });

  it('repeated same eventVersion does not duplicate', async () => {
    queryMock
      .mockResolvedValueOnce({ recordset: [] })
      .mockRejectedValueOnce(new Error('Violation of UQ_TblBookingNotify_Key'));

    const { scheduleBookingEventWhatsApp } = await import(
      '@/lib/booking/bookingEventWhatsApp'
    );
    const r = await scheduleBookingEventWhatsApp({
      bookingId: 42,
      bookingCode: 'BK-42',
      eventType: 'move',
      eventVersion: 'v1',
      phone: '201012345678',
      customerName: 'عميل',
      bookingDate: '2026-08-17',
      bookingTime: '15:00',
    });
    expect(r.scheduled).toBe(false);
    expect(r.skippedReason).toBe('duplicate');
    expect(scheduleAfterCommit).not.toHaveBeenCalled();
  });

  it('new eventVersion may create a new notification', async () => {
    queryMock
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const { scheduleBookingEventWhatsApp } = await import(
      '@/lib/booking/bookingEventWhatsApp'
    );
    const r = await scheduleBookingEventWhatsApp({
      bookingId: 42,
      bookingCode: 'BK-42',
      eventType: 'move',
      eventVersion: 'v2-new',
      phone: '201012345678',
      customerName: 'عميل',
      bookingDate: '2026-08-17',
      bookingTime: '16:00',
    });
    expect(r.scheduled).toBe(true);
    expect(r.idempotencyKey).toBe('wa:move:42:v2-new');
  });

  it('cancel queues one message', async () => {
    queryMock
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const { scheduleBookingEventWhatsApp } = await import(
      '@/lib/booking/bookingEventWhatsApp'
    );
    const r = await scheduleBookingEventWhatsApp({
      bookingId: 7,
      bookingCode: 'BK-7',
      eventType: 'cancel',
      eventVersion: 'c1',
      phone: '201012345678',
      customerName: 'عميل',
      bookingDate: '2026-08-17',
      bookingTime: '15:00',
      cancelled: true,
    });
    expect(r.scheduled).toBe(true);
    expect(scheduleAfterCommit).toHaveBeenCalledTimes(1);
  });

  it('missing phone records failed without scheduling send', async () => {
    queryMock
      .mockResolvedValueOnce({ recordset: [] }) // ensure
      .mockResolvedValueOnce({ recordset: [] }) // insert
      .mockResolvedValueOnce({ recordset: [] }); // mark failed

    const { scheduleBookingEventWhatsApp } = await import(
      '@/lib/booking/bookingEventWhatsApp'
    );
    const r = await scheduleBookingEventWhatsApp({
      bookingId: 9,
      bookingCode: 'BK-9',
      eventType: 'move',
      eventVersion: 'v1',
      phone: null,
      customerName: 'عميل',
      bookingDate: '2026-08-17',
      bookingTime: '15:00',
    });
    expect(r.scheduled).toBe(false);
    expect(r.skippedReason).toBe('no_phone');
    expect(scheduleAfterCommit).not.toHaveBeenCalled();
  });

  it('invalid phone does not crash and records failure', async () => {
    queryMock
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });

    const { scheduleBookingEventWhatsApp } = await import(
      '@/lib/booking/bookingEventWhatsApp'
    );
    const r = await scheduleBookingEventWhatsApp({
      bookingId: 9,
      bookingCode: 'BK-9',
      eventType: 'cancel',
      eventVersion: 'v1',
      phone: '123',
      customerName: 'عميل',
      bookingDate: '2026-08-17',
      bookingTime: '15:00',
      cancelled: true,
    });
    expect(r.scheduled).toBe(false);
    expect(r.skippedReason).toBe('no_phone');
  });

  it('retry succeeds for failed only', async () => {
    queryMock
      .mockResolvedValueOnce({ recordset: [] }) // ensure
      .mockResolvedValueOnce({
        recordset: [
          {
            NotifyID: 1,
            IdempotencyKey: 'wa:move:42:v1',
            EventType: 'move',
            Status: 'failed',
            RetryCount: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ recordset: [{ Claimed: 1 }] });

    const { retryBookingEventWhatsApp } = await import(
      '@/lib/booking/bookingEventWhatsApp'
    );
    const r = await retryBookingEventWhatsApp({ bookingId: 42, eventType: 'move' });
    expect(r.ok).toBe(true);
    expect(scheduleAfterCommit).toHaveBeenCalledTimes(1);
  });

  it('never retries a sent event', async () => {
    queryMock
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({
        recordset: [
          {
            NotifyID: 1,
            IdempotencyKey: 'wa:move:42:v1',
            EventType: 'move',
            Status: 'sent',
            RetryCount: 0,
          },
        ],
      });

    const { retryBookingEventWhatsApp } = await import(
      '@/lib/booking/bookingEventWhatsApp'
    );
    const r = await retryBookingEventWhatsApp({ bookingId: 42 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('ALREADY_SENT');
    expect(scheduleAfterCommit).not.toHaveBeenCalled();
  });

  it('concurrent retries do not duplicate (CAS claim fail)', async () => {
    queryMock
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({
        recordset: [
          {
            NotifyID: 1,
            IdempotencyKey: 'wa:move:42:v1',
            EventType: 'move',
            Status: 'failed',
            RetryCount: 2,
          },
        ],
      })
      .mockResolvedValueOnce({ recordset: [{ Claimed: 0 }] });

    const { retryBookingEventWhatsApp } = await import(
      '@/lib/booking/bookingEventWhatsApp'
    );
    const r = await retryBookingEventWhatsApp({ bookingId: 42 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('RETRY_IN_PROGRESS');
    expect(scheduleAfterCommit).not.toHaveBeenCalled();
  });
});

describe('bookingCancellationPostCommit contract', () => {
  it('wires cancel WhatsApp after commit', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const svc = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingCancellation.ts'),
      'utf8',
    );
    expect(svc).toContain('scheduleCancelWhatsAppAfterCommit');
    expect(svc.indexOf('await transaction.commit()')).toBeLessThan(
      svc.indexOf('scheduleCancelWhatsAppAfterCommit'),
    );
  });
});
