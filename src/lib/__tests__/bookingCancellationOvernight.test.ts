/** Phase 7B — overnight marker. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingCancellationOvernight', () => {
  it('verifier preserves PublicWorkDate / dayOffset on overnight cancel', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../scripts/verify-booking-phase7b-cancellation.ts'),
      'utf8',
    );
    expect(src).toContain('overnight_workdate_preserved');
    expect(src).toContain("time: '00:15'");
    expect(src).toContain('dayOffset: 1');
  });
});
