/**
 * Phase 2 — WhatsApp post-response scheduling, submit guards, flow-board dedupe.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  maskPhoneForLog,
  scheduleBookingWhatsAppAfterCommit,
} from '@/lib/bookingPostCommitNotification';
import {
  acquireSubmitGuard,
  BOOKING_SUCCESS_CLOSE_DELAY_MS,
  parseBookingCreateSuccess,
  releaseSubmitGuard,
} from '@/lib/operations/bookingWorkspaceSubmit';
import {
  createFlowBoardRefreshController,
  shouldRefreshBoardForBooking,
} from '@/lib/operations/flowBoardRefreshController';

describe('booking WhatsApp post-commit scheduling', () => {
  it('schedules WhatsApp exactly once after commit and does not await send', async () => {
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { sent: true, skipped: false, status: 'submitted' as const };
    }) as unknown as typeof import('@/lib/integrations/whatsapp').sendBookingWhatsAppMessage;
    let scheduledTask: (() => Promise<void>) | null = null;
    const schedule = vi.fn((task: () => Promise<void>) => {
      scheduledTask = task;
    });

    const result = scheduleBookingWhatsAppAfterCommit(
      {
        phone: '01099998877',
        customerName: 'PHASE2_PERF_TEST',
        bookingId: 9999,
        bookingDate: '2026-07-16',
        bookingTime: '14:00',
      },
      { schedule, send },
    );

    expect(result.scheduled).toBe(true);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();

    await scheduledTask!();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('WhatsApp rejection does not throw out of the scheduled task', async () => {
    const send = vi.fn(async () => {
      throw new Error('remote down');
    });
    let scheduledTask: (() => Promise<void>) | null = null;
    const schedule = vi.fn((task: () => Promise<void>) => {
      scheduledTask = task;
    });

    scheduleBookingWhatsAppAfterCommit(
      {
        phone: '01099998877',
        customerName: 'PHASE2_PERF_TEST',
        bookingId: 1000,
        bookingDate: '2026-07-16',
        bookingTime: '14:00',
      },
      { schedule, send },
    );

    await expect(scheduledTask!()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('masks phone PII in helper', () => {
    expect(maskPhoneForLog('01099998877')).toBe('010****77');
    expect(maskPhoneForLog('12')).toBe('****');
  });
});

describe('booking workspace submit lifecycle helpers', () => {
  it('keeps success close delay at most 200ms (0 preferred)', () => {
    expect(BOOKING_SUCCESS_CLOSE_DELAY_MS).toBeLessThanOrEqual(200);
    expect(BOOKING_SUCCESS_CLOSE_DELAY_MS).toBe(0);
  });

  it('blocks a second confirm while submittingRef is active', () => {
    const ref = { current: false };
    expect(acquireSubmitGuard(ref)).toBe(true);
    expect(acquireSubmitGuard(ref)).toBe(false);
    releaseSubmitGuard(ref);
    expect(acquireSubmitGuard(ref)).toBe(true);
  });

  it('parses create success actualDate for board refresh decisions', () => {
    const parsed = parseBookingCreateSuccess({
      ok: true,
      booking: { id: 1, code: 'BK-X', actualDate: '2026-07-20', date: '2026-07-19' },
    });
    expect(parsed?.actualDate).toBe('2026-07-20');
  });

  it('refresh failure must not flip booking success (parent responsibility)', () => {
    // Booking success is determined solely by HTTP 201 + parse; refresh is independent.
    const success = parseBookingCreateSuccess({
      ok: true,
      booking: { id: 2, actualDate: '2026-07-16' },
    });
    expect(success).not.toBeNull();
    expect(shouldRefreshBoardForBooking('2026-07-16', success!.actualDate)).toBe(true);
  });
});

describe('flow-board refresh controller', () => {
  it('dedupes two identical refresh calls into one GET', async () => {
    let resolveFetch!: (v: { ok: boolean; date: string }) => void;
    const fetchBoard = vi.fn(
      () =>
        new Promise<{ ok: boolean; date: string }>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const onData = vi.fn();
    let selected = '2026-07-16';
    const ctrl = createFlowBoardRefreshController({
      getSelectedDate: () => selected,
      fetchBoard: fetchBoard as any,
      onData,
    });

    const p1 = ctrl.refreshFlowBoard('2026-07-16', { reason: 'a' });
    const p2 = ctrl.refreshFlowBoard('2026-07-16', { reason: 'b' });
    expect(fetchBoard).toHaveBeenCalledTimes(1);

    resolveFetch!({ ok: true, date: '2026-07-16' });
    await Promise.all([p1, p2]);
    expect(onData).toHaveBeenCalledTimes(1);
  });

  it('coalesces poll and post-create refresh on the same date', async () => {
    let resolveFetch!: (v: { ok: boolean; date: string }) => void;
    const fetchBoard = vi.fn(
      () =>
        new Promise<{ ok: boolean; date: string }>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const ctrl = createFlowBoardRefreshController({
      getSelectedDate: () => '2026-07-16',
      fetchBoard: fetchBoard as any,
      onData: vi.fn(),
    });

    const poll = ctrl.refreshFlowBoard('2026-07-16', { reason: 'poll' });
    const created = ctrl.refreshFlowBoard('2026-07-16', { reason: 'booking-created' });
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    resolveFetch!({ ok: true, date: '2026-07-16' });
    await Promise.all([poll, created]);
  });

  it('does not apply a stale response after selected date changes', async () => {
    let resolveFetch!: (v: { ok: boolean; date: string }) => void;
    const fetchBoard = vi.fn(
      () =>
        new Promise<{ ok: boolean; date: string }>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const onData = vi.fn();
    let selected = '2026-07-16';
    const ctrl = createFlowBoardRefreshController({
      getSelectedDate: () => selected,
      fetchBoard: fetchBoard as any,
      onData,
    });

    const p = ctrl.refreshFlowBoard('2026-07-16', { reason: 'mount' });
    selected = '2026-07-17';
    resolveFetch!({ ok: true, date: '2026-07-16' });
    await p;
    expect(onData).not.toHaveBeenCalled();
  });

  it('booking on displayed date should refresh; other date should not', () => {
    expect(shouldRefreshBoardForBooking('2026-07-16', '2026-07-16')).toBe(true);
    expect(shouldRefreshBoardForBooking('2026-07-16', '2026-07-20')).toBe(false);
  });
});
