/**
 * Booking Phase 2 — duration contract (catalog vs plan consumers).
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_PUBLIC_BOOKING_DURATION_MINUTES,
  resolvePublicCatalogDurationMinutes,
} from '@/lib/booking/publicBookingServicePolicy';
import { resolveOneServiceDuration } from '@/lib/empServiceDuration';
import fs from 'fs';
import path from 'path';

describe('bookingServiceDurationContract', () => {
  it('catalog requires positive integer within max; no system fallback', () => {
    expect(resolvePublicCatalogDurationMinutes(null)).toBeNull();
    expect(resolvePublicCatalogDurationMinutes(0)).toBeNull();
    expect(resolvePublicCatalogDurationMinutes(30.6)).toBe(31);
    expect(resolvePublicCatalogDurationMinutes(MAX_PUBLIC_BOOKING_DURATION_MINUTES + 1)).toBeNull();
    expect(resolvePublicCatalogDurationMinutes(90)).toBe(90);
  });

  it('documents Phase-2 catalog duration vs legacy emp/system path', () => {
    const planPath = resolveOneServiceDuration({
      overrideMinutes: null,
      serviceDefaultMinutes: null,
      systemDefaultMinutes: 30,
    });
    expect(planPath.durationSource).toBe('SYSTEM_DEFAULT');
    expect(planPath.durationMinutes).toBe(30);

    const withService = resolveOneServiceDuration({
      overrideMinutes: null,
      serviceDefaultMinutes: 45,
      systemDefaultMinutes: 30,
    });
    expect(withService.durationSource).toBe('SERVICE_DEFAULT');
    expect(withService.durationMinutes).toBe(45);

    // Phase 5 public check-slot/plan use resolveSelectedBookingServices only
    const evaluator = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingSelectionEvaluator.ts'),
      'utf8',
    );
    expect(evaluator).toContain('resolveSelectedBookingServices');
    expect(evaluator).not.toContain('calculateServicePlanDuration');
  });

  it('lists duration consumers that must converge later (Phase 3+)', () => {
    const consumers = [
      'src/lib/booking/publicBookingServicePolicy.ts',
      'src/lib/empServiceDuration.ts',
      'src/lib/servicePlan.ts',
      'src/lib/bookingAvailabilityEngine.ts',
      'src/app/api/public/booking/available-slots/route.ts',
    ];
    for (const rel of consumers) {
      const full = path.join(process.cwd(), rel);
      expect(fs.existsSync(full), rel).toBe(true);
    }
    // Catalog must NOT use ISNULL fallback for DurationMinutes
    const oldPattern = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/public/booking/services/route.ts'),
      'utf8',
    );
    expect(oldPattern).not.toMatch(/ISNULL\(p\.DurationMinutes/i);
  });
});
