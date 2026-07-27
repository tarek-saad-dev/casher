/**
 * Booking Phase 7B — cancellation policy / ownership / idempotency / security contracts.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

import {
  resolvePublicCancellationCutoff,
  PUBLIC_CANCELLATION_CUTOFF_MINUTES,
  isApprovedReasonCode,
} from '@/lib/booking/publicBookingCancellationPolicy';
import { mapPublicBookingStatus } from '@/lib/booking/publicBookingStatus';
import {
  buildCancelRequestFingerprint,
  BOOKING_CANCEL_CONTRACT_VERSION,
} from '@/lib/booking/publicBookingCancelIdempotency';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';
import { normalizePublicBookingCode } from '@/lib/booking/publicBookingReader';
import {
  mintBookingAccessToken,
  verifyBookingAccessToken,
} from '@/lib/booking/publicBookingAccessToken';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('bookingPublicCancellationPolicy', () => {
  const startFar = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const startSoon = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  it('confirmed/pending open when AbsoluteStartUtc far enough', () => {
    for (const status of ['confirmed', 'pending']) {
      const r = resolvePublicCancellationCutoff({
        statusRaw: status,
        absoluteStartUtc: startFar,
        dateSource: 'canonical',
      });
      expect(r.windowOpen).toBe(true);
      expect(r.cutoffMinutes).toBe(PUBLIC_CANCELLATION_CUTOFF_MINUTES);
    }
  });

  it('window closed within cutoff', () => {
    const r = resolvePublicCancellationCutoff({
      statusRaw: 'confirmed',
      absoluteStartUtc: startSoon,
      dateSource: 'canonical',
    });
    expect(r.windowOpen).toBe(false);
    expect(r.reason).toBe('window_closed');
  });

  it('rejects in_service / completed / no_show / cancelled / ambiguous', () => {
    expect(
      resolvePublicCancellationCutoff({
        statusRaw: 'in_service',
        absoluteStartUtc: startFar,
        dateSource: 'canonical',
      }).reason,
    ).toBe('in_service');
    expect(
      resolvePublicCancellationCutoff({
        statusRaw: 'completed',
        absoluteStartUtc: startFar,
        dateSource: 'canonical',
      }).reason,
    ).toBe('completed');
    expect(
      resolvePublicCancellationCutoff({
        statusRaw: 'no_show',
        absoluteStartUtc: startFar,
        dateSource: 'canonical',
      }).reason,
    ).toBe('no_show');
    expect(
      resolvePublicCancellationCutoff({
        statusRaw: 'cancelled',
        absoluteStartUtc: startFar,
        dateSource: 'canonical',
      }).reason,
    ).toBe('already_cancelled');
    expect(
      resolvePublicCancellationCutoff({
        statusRaw: 'confirmed',
        absoluteStartUtc: null,
        dateSource: 'ambiguous',
      }).reason,
    ).toBe('ambiguous_start');
  });

  it('approved reason codes', () => {
    expect(isApprovedReasonCode('customer_changed_plans')).toBe(true);
    expect(isApprovedReasonCode('hack')).toBe(false);
  });
});

describe('bookingCancellationOwnership / security contracts', () => {
  it('routes call cancelPublicBooking; reject BookingID; rate limit 10', () => {
    const generic = read('src/app/api/public/booking/cancel/route.ts');
    const codeRoute = read('src/app/api/public/booking/[code]/cancel/route.ts');
    expect(generic).toContain('cancelPublicBooking');
    expect(codeRoute).toContain('cancelPublicBooking');
    expect(generic).toContain('numeric_booking_id_rejected');
    expect(generic).toContain('checkRateLimit');
    expect(generic).toContain(', 10)');
    expect(codeRoute).toContain(', 10)');
    expect(generic).toContain('OPTIONS');
    expect(codeRoute).toContain('OPTIONS');
    expect(generic).not.toContain("Status = 'Cancelled'");
    expect(codeRoute).not.toContain('BookingID = @id');
  });

  it('rejects numeric BookingID via normalizePublicBookingCode', () => {
    expect(() => normalizePublicBookingCode('42')).toThrow();
  });

  it('token cannot authorize a different code', () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'phase7b-test-secret';
    const { token } = mintBookingAccessToken({
      bookingCode: 'BK-AAAA01',
      normalizedPhone: '01012345678',
    });
    const v = verifyBookingAccessToken({
      token,
      bookingCode: 'BK-BBBB02',
    });
    expect(v.ok).toBe(false);
  });
});

describe('bookingCancellationIdempotency', () => {
  it('fingerprint stable; changes with reason', () => {
    const a = buildCancelRequestFingerprint({
      contractVersion: BOOKING_CANCEL_CONTRACT_VERSION,
      bookingCode: 'BK-TEST01',
      ownershipDigest: 'abc',
      reasonCode: 'other',
      reasonText: null,
    });
    const b = buildCancelRequestFingerprint({
      contractVersion: BOOKING_CANCEL_CONTRACT_VERSION,
      bookingCode: 'BK-TEST01',
      ownershipDigest: 'abc',
      reasonCode: 'other',
      reasonText: null,
    });
    const c = buildCancelRequestFingerprint({
      contractVersion: BOOKING_CANCEL_CONTRACT_VERSION,
      bookingCode: 'BK-TEST01',
      ownershipDigest: 'abc',
      reasonCode: 'customer_sick',
      reasonText: null,
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });

  it('idempotency table DDL present', () => {
    const src = read('src/lib/booking/publicBookingCancelIdempotency.ts');
    expect(src).toContain('TblPublicBookingCancelRequest');
    expect(src).toContain('claimCancelIdempotencyAutonomous');
    expect(src).toContain('NotificationSent');
  });
});

describe('bookingPublicCancellation service contracts', () => {
  it('service uses SERIALIZABLE, cancel lock, emp interval lock, no hard delete', () => {
    const svc = read('src/lib/booking/publicBookingCancellation.ts');
    expect(svc).toContain('SERIALIZABLE');
    expect(svc).toContain('booking:cancel:');
    expect(svc).toContain('empIntervalLockResource');
    expect(svc).toContain("Status = N'cancelled'");
    expect(svc).not.toContain('DELETE FROM dbo.Bookings');
    expect(svc).toContain('invalidatePublicBookingAvailabilityCache');
    expect(svc).toContain('probeSlotRelease');
    expect(svc).toContain('PublicCancelledAtUtc');
    expect(svc).toContain('customer_public');
  });

  it('reader canCancel uses shared cutoff resolver', () => {
    const reader = read('src/lib/booking/publicBookingReader.ts');
    expect(reader).toContain('resolvePublicCancellationCutoff');
    expect(reader).not.toContain('MIN_CANCEL_MINUTES');
  });

  it('status mapper cancelled → canCancel false', () => {
    const m = mapPublicBookingStatus('cancelled');
    expect(m.status).toBe('cancelled');
    expect(m.canCancel).toBe(false);
  });

  it('error catalog includes Phase 7B cancel codes', () => {
    for (const code of [
      'BOOKING_ALREADY_CANCELLED',
      'BOOKING_NOT_CANCELLABLE',
      'BOOKING_CANCELLATION_WINDOW_CLOSED',
      'BOOKING_CANCELLATION_REQUIRES_STAFF',
      'BOOKING_ALREADY_IN_SERVICE',
      'BOOKING_ALREADY_COMPLETED',
      'BOOKING_HAS_PAYMENT',
      'IDEMPOTENCY_KEY_REQUIRED',
      'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
      'BOOKING_CANCELLATION_FAILED',
    ] as const) {
      expect(PUBLIC_BOOKING_ERROR_CATALOG[code].code).toBe(code);
    }
  });

  it('smoke registry / verifier script exists', () => {
    expect(fs.existsSync(path.join(root, 'scripts/verify-booking-phase7b-cancellation.ts'))).toBe(
      true,
    );
  });
});
