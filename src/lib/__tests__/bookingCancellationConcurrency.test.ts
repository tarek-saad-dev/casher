/** Phase 7B — concurrency contract markers (live: verify-booking-phase7b-cancellation.ts). */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingCancellationConcurrency', () => {
  it('verifier covers same-key and different-key races', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../scripts/verify-booking-phase7b-cancellation.ts'),
      'utf8',
    );
    expect(src).toContain('concurrent_same_key');
    expect(src).toContain('concurrent_diff_keys');
    expect(src).toContain('Promise.all');
  });
});
