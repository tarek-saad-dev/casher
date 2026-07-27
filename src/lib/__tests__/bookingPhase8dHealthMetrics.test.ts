/** Booking Phase 8D — post-cutover health metrics helpers. */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

import {
  mapRouteKeyToTimingFamily,
  percentileNearestRank,
  sanitizePublicBookingErrorCode,
} from '@/lib/booking/publicBookingHealthMetrics';

describe('bookingPhase8dHealthMetrics', () => {
  it('maps route keys to timing families', () => {
    expect(mapRouteKeyToTimingFamily('available-days')).toBe('availability');
    expect(mapRouteKeyToTimingFamily('available-slots')).toBe('availability');
    expect(mapRouteKeyToTimingFamily('check-slot')).toBe('availability');
    expect(mapRouteKeyToTimingFamily('plan')).toBe('plan');
    expect(mapRouteKeyToTimingFamily('create')).toBe('create');
    expect(mapRouteKeyToTimingFamily('cancel')).toBe('cancel');
    expect(mapRouteKeyToTimingFamily('cancel-by-code')).toBe('cancel');
    expect(mapRouteKeyToTimingFamily('branches')).toBe('other');
  });

  it('sanitizes error codes and rejects PII-like values', () => {
    expect(sanitizePublicBookingErrorCode('PLAN_TOKEN_REQUIRED')).toBe(
      'PLAN_TOKEN_REQUIRED',
    );
    expect(sanitizePublicBookingErrorCode('plan_token_required')).toBe(
      'PLAN_TOKEN_REQUIRED',
    );
    expect(sanitizePublicBookingErrorCode('01012345678')).toBeNull();
    expect(sanitizePublicBookingErrorCode('eyJhbGciOiJIUzI1NiJ9.abc.def')).toBeNull();
    expect(sanitizePublicBookingErrorCode('name=Ali')).toBeNull();
    expect(sanitizePublicBookingErrorCode(null)).toBeNull();
  });

  it('computes nearest-rank percentiles', () => {
    expect(percentileNearestRank([], 50)).toBeNull();
    expect(percentileNearestRank([10], 50)).toBe(10);
    expect(percentileNearestRank([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentileNearestRank([1, 2, 3, 4, 5], 95)).toBe(5);
  });

  it('wires health sample recording into the public route gate', () => {
    const gate = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingRouteGate.ts'),
      'utf8',
    );
    expect(gate).toContain('logPublicBookingRequest');
    expect(gate).toContain('recordPublicBookingHealthSample');
    expect(gate).toContain('rate_limited');
    expect(gate).toContain('startedAtMs');
  });

  it('exposes admin health endpoint and report script without PII fields', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/admin/public-booking/health/route.ts'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(process.cwd(), 'scripts/report-booking-phase8d-health.ts'),
      'utf8',
    );
    const metrics = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingHealthMetrics.ts'),
      'utf8',
    );
    expect(route).toContain('requireAdmin');
    expect(route).toContain('buildPublicBookingHealthSummary');
    expect(script).toContain('buildPublicBookingHealthSummary');
    expect(metrics).toContain('mutation_outcome_unknown');
    expect(metrics).toContain('PLAN_TOKEN_');
    expect(metrics).toContain('TblPublicBookingHealthSample');
    expect(metrics).not.toContain('customerPhone');
    expect(metrics).not.toContain('accessToken');
    expect(metrics).not.toContain('bookingAccessToken');
    expect(metrics).not.toContain('RequestFingerprint');
  });

  it('marks create/cancel uncaught failures as mutation_outcome_unknown', () => {
    const create = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/public/booking/create/route.ts'),
      'utf8',
    );
    const cancel = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/public/booking/cancel/route.ts'),
      'utf8',
    );
    expect(create).toContain("outcome: 'mutation_outcome_unknown'");
    expect(create).toContain('idempotent_replay');
    expect(cancel).toContain("outcome: 'mutation_outcome_unknown'");
    expect(cancel).toContain('idempotent_replay');
  });
});
