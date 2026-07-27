/**
 * Phase 7A — public booking reader / status / access-token contract tests.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

import {
  mapPublicBookingStatus,
  isUpcomingEligibleStatus,
} from '@/lib/booking/publicBookingStatus';
import {
  mintBookingAccessToken,
  verifyBookingAccessToken,
  digestNormalizedPhone,
} from '@/lib/booking/publicBookingAccessToken';
import {
  normalizePublicBookingCode,
  PublicBookingReadError,
} from '@/lib/booking/publicBookingReader';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('bookingPublicReader contract', () => {
  it('routes use canonical reader (no BookingID fallback / inline SQL)', () => {
    const codeRoute = read('src/app/api/public/booking/[code]/route.ts');
    const upcoming = read('src/app/api/public/booking/upcoming/route.ts');
    expect(codeRoute).toContain('getPublicBookingByCode');
    expect(codeRoute).not.toContain('BookingID = @id');
    expect(upcoming).toContain('listPublicUpcomingBookings');
    expect(upcoming).toContain('checkRateLimit');
    expect(upcoming).not.toContain("Status NOT IN ('Cancelled'");
  });

  it('create mints bookingAccessToken', () => {
    const create = read('src/lib/booking/publicBookingCreate.ts');
    expect(create).toContain('mintBookingAccessToken');
    expect(create).toContain('bookingAccessToken');
  });

  it('error catalog includes Phase 7A codes', () => {
    for (const code of [
      'INVALID_BOOKING_CODE',
      'BOOKING_NOT_FOUND',
      'BOOKING_NOT_FOUND_OR_UNAUTHORIZED',
      'INVALID_CUSTOMER_PHONE',
      'BOOKING_ACCESS_TOKEN_INVALID',
      'BOOKING_ACCESS_TOKEN_EXPIRED',
      'INVALID_LIMIT',
      'INVALID_FROM_DATE',
    ] as const) {
      expect(PUBLIC_BOOKING_ERROR_CATALOG[code].code).toBe(code);
    }
  });
});

describe('bookingLookupOwnership / code', () => {
  it('rejects numeric BookingID and malformed codes before SQL', () => {
    expect(() => normalizePublicBookingCode('12345')).toThrow(PublicBookingReadError);
    expect(() => normalizePublicBookingCode('')).toThrow(PublicBookingReadError);
    expect(() => normalizePublicBookingCode('BK-@@@')).toThrow(PublicBookingReadError);
    expect(normalizePublicBookingCode(' bk-a3x9k2 ')).toBe('BK-A3X9K2');
  });
});

describe('bookingAccessToken', () => {
  it('mints and verifies; rejects code mismatch and expiry', () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'phase7a-test-secret';
    const { token } = mintBookingAccessToken({
      bookingCode: 'BK-TEST01',
      normalizedPhone: '01012345678',
    });
    expect(token.includes('.')).toBe(true);
    expect(JSON.stringify(token)).not.toContain('01012345678');

    const ok = verifyBookingAccessToken({
      token,
      bookingCode: 'BK-TEST01',
      normalizedPhone: '01012345678',
    });
    expect(ok.ok).toBe(true);

    const mismatch = verifyBookingAccessToken({
      token,
      bookingCode: 'BK-OTHER1',
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.reason).toBe('code_mismatch');

    const expired = verifyBookingAccessToken({
      token,
      bookingCode: 'BK-TEST01',
      nowSec: Math.floor(Date.now() / 1000) + 40 * 24 * 60 * 60,
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe('expired');

    expect(digestNormalizedPhone('01012345678')).toHaveLength(64);
  });
});

describe('bookingReadStatusMapping', () => {
  it('maps lowercase and legacy PascalCase; upcoming excludes cancelled/completed', () => {
    expect(mapPublicBookingStatus('confirmed').status).toBe('confirmed');
    expect(mapPublicBookingStatus('Cancelled').status).toBe('cancelled');
    expect(mapPublicBookingStatus('Completed').status).toBe('completed');
    expect(mapPublicBookingStatus('done').status).toBe('completed');
    expect(mapPublicBookingStatus('in_service').canCancel).toBe(false);
    expect(isUpcomingEligibleStatus('confirmed')).toBe(true);
    expect(isUpcomingEligibleStatus('cancelled')).toBe(false);
    expect(isUpcomingEligibleStatus('completed')).toBe(false);
    expect(isUpcomingEligibleStatus('no_show')).toBe(false);
    expect(mapPublicBookingStatus('weird_legacy').status).toBe('unknown');
  });
});

describe('bookingReadSecurity contract', () => {
  it('reader hides smoke/internal sources and does not expose Notes metadata publicly without ownership', () => {
    const reader = read('src/lib/booking/publicBookingReader.ts');
    expect(reader).toContain('smoke_seed');
    expect(reader).toContain('internal_preview');
    expect(reader).toContain('sanitizeOwnerNotes');
    expect(reader).toContain("mode === 'minimal'");
    expect(reader).not.toContain('WHERE b.BookingID =');
  });
});

describe('bookingReadSmokeRegistry', () => {
  it('documents Phase 7A smoke phase name', () => {
    expect(fs.existsSync(path.join(root, 'docs/booking-phase-7a-read-audit.md'))).toBe(true);
  });
});
