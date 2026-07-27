/** Booking Phase 7C2 — contract mode (compat vs enforce). */
import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getPublicBookingContractMode,
  isPublicBookingEnforceMode,
  PUBLIC_BOOKING_API_CONTRACT_VERSION,
  PUBLIC_BOOKING_CONTRACT_VERSION_HEADER,
} from '@/lib/booking/publicBookingContractMode';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bookingContractMode', () => {
  it('defaults to compat when env unset or unknown', () => {
    expect(getPublicBookingContractMode({})).toBe('compat');
    expect(getPublicBookingContractMode({ PUBLIC_BOOKING_CONTRACT_MODE: '' })).toBe('compat');
    expect(getPublicBookingContractMode({ PUBLIC_BOOKING_CONTRACT_MODE: 'invalid' })).toBe(
      'compat',
    );
    expect(isPublicBookingEnforceMode({})).toBe(false);
  });

  it('returns enforce when PUBLIC_BOOKING_CONTRACT_MODE=enforce', () => {
    expect(
      getPublicBookingContractMode({ PUBLIC_BOOKING_CONTRACT_MODE: 'enforce' }),
    ).toBe('enforce');
    expect(
      getPublicBookingContractMode({ PUBLIC_BOOKING_CONTRACT_MODE: ' ENFORCE ' }),
    ).toBe('enforce');
    expect(
      isPublicBookingEnforceMode({ PUBLIC_BOOKING_CONTRACT_MODE: 'enforce' }),
    ).toBe(true);
  });

  it('logs production warn once when enforce is active', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { NODE_ENV: 'production', PUBLIC_BOOKING_CONTRACT_MODE: 'enforce' };
    getPublicBookingContractMode(env);
    getPublicBookingContractMode(env);
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(warn.mock.calls[0]![0]));
    expect(payload.event).toBe('public_booking.contract_mode_enforce');
  });

  it('exports stable contract version constants', () => {
    expect(PUBLIC_BOOKING_API_CONTRACT_VERSION).toBe('booking-public-v1');
    expect(PUBLIC_BOOKING_CONTRACT_VERSION_HEADER).toBe('X-Booking-Contract-Version');
  });
});
