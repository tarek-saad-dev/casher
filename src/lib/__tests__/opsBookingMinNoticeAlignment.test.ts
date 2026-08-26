/**
 * Ops booking create must not re-apply public min-notice after slots listed with notice=0.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('ops booking create min-notice alignment', () => {
  it('evaluatePublicBookingSelection uses operations source for internal_preview', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingSelectionEvaluator.ts'),
      'utf8',
    );
    expect(src).toContain("purpose === 'internal_preview' ? 'operations' : 'public'");
    expect(src).toContain('effectiveMinNoticeMinutes');
    expect(src).toContain('isMinNoticeNotMet');
    expect(src).toContain('minNoticeBlocked');
    // Must not hardcode public for create validation anymore
    expect(src).not.toMatch(/validateBookingSlot\(\{[\s\S]*?source:\s*'public'/);
  });
});
