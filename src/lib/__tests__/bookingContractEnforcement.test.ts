/** Booking Phase 7C2 — enforce mode rejects legacy create/cancel contracts. */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/booking/publicBookingCancelIdempotency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/booking/publicBookingCancelIdempotency')>();
  return {
    ...actual,
    ensurePublicBookingCancelIdempotencyTable: vi.fn().mockResolvedValue(undefined),
    ensurePublicBookingCancelColumns: vi.fn().mockResolvedValue(undefined),
  };
});

describe('bookingContractEnforcement', () => {
  const prevMode = process.env.PUBLIC_BOOKING_CONTRACT_MODE;

  beforeEach(() => {
    process.env.PUBLIC_BOOKING_CONTRACT_MODE = 'enforce';
  });

  afterEach(() => {
    if (prevMode === undefined) delete process.env.PUBLIC_BOOKING_CONTRACT_MODE;
    else process.env.PUBLIC_BOOKING_CONTRACT_MODE = prevMode;
  });

  it('createPublicBooking throws PLAN_TOKEN_REQUIRED in enforce mode', async () => {
    const { createPublicBooking, PublicBookingCreateError } = await import(
      '@/lib/booking/publicBookingCreate'
    );
    await expect(
      createPublicBooking({
        customer: { name: 'Test User', phone: '01012345678' },
        date: '2026-12-01',
        time: '10:00',
        branchCode: 'GLEEM',
        serviceIds: [1],
        clientRequestId: 'req-1',
      }),
    ).rejects.toBeInstanceOf(PublicBookingCreateError);
    await expect(
      createPublicBooking({
        customer: { name: 'Test User', phone: '01012345678' },
        date: '2026-12-01',
        time: '10:00',
        branchCode: 'GLEEM',
        serviceIds: [1],
        clientRequestId: 'req-1',
      }),
    ).rejects.toMatchObject({ code: 'PLAN_TOKEN_REQUIRED' });
  });

  it('createPublicBooking throws IDEMPOTENCY_KEY_REQUIRED when plan token present', async () => {
    const { createPublicBooking } = await import('@/lib/booking/publicBookingCreate');
    await expect(
      createPublicBooking({
        customer: { name: 'Test User', phone: '01012345678' },
        date: '2026-12-01',
        time: '10:00',
        branchCode: 'GLEEM',
        serviceIds: [1],
        planToken: 'plan-token',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('cancelPublicBooking throws IDEMPOTENCY_KEY_REQUIRED in enforce mode', async () => {
    const { cancelPublicBooking, PublicBookingCancelError } = await import(
      '@/lib/booking/publicBookingCancellation'
    );
    await expect(
      cancelPublicBooking({
        code: 'BK-HJKMNP',
        phone: '01012345678',
      }),
    ).rejects.toBeInstanceOf(PublicBookingCancelError);
    await expect(
      cancelPublicBooking({
        code: 'BK-HJKMNP',
        phone: '01012345678',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('compat mode logs legacy use instead of PLAN_TOKEN_REQUIRED', async () => {
    process.env.PUBLIC_BOOKING_CONTRACT_MODE = 'compat';
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { createPublicBooking } = await import('@/lib/booking/publicBookingCreate');
    await expect(
      createPublicBooking({
        customer: { name: 'Test User', phone: '01012345678' },
        date: '2026-12-01',
        time: '10:00',
        branchCode: 'GLEEM',
        serviceIds: [1],
        clientRequestId: 'req-compat',
      }),
    ).rejects.not.toMatchObject({ code: 'PLAN_TOKEN_REQUIRED' });
    expect(
      logSpy.mock.calls.some((c) => String(c[0]).includes('public_booking.legacy_contract_used')),
    ).toBe(true);
    logSpy.mockRestore();
  });
});
