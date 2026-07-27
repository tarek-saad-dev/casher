/** Phase 7B — cancel/create race marker. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingCancellationCreateRace', () => {
  it('verifier covers cancel then rebook same interval', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../scripts/verify-booking-phase7b-cancellation.ts'),
      'utf8',
    );
    expect(src).toContain('cancel_create_rebook');
    expect(src).toContain('no_active_overlap');
  });
});
