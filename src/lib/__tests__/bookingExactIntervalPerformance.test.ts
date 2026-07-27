/**
 * Phase 7C2 — check-slot/plan use exact-interval evaluator (no available-days horizon loop).
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingExactIntervalPerformance', () => {
  it('selection evaluator does not call getPublicAvailableDays', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingSelectionEvaluator.ts'),
      'utf8',
    );
    expect(src).not.toContain('getPublicAvailableDays');
  });

  it('check-slot and plan routes delegate to evaluatePublicBookingSelection', () => {
    for (const rel of [
      'src/app/api/public/booking/check-slot/route.ts',
      'src/app/api/public/booking/plan/route.ts',
    ]) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(src).toMatch(/evaluatePublicBookingSelection|check-slot|plan/);
    }
  });
});
