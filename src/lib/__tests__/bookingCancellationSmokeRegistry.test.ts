/** Phase 7B — smoke registry / verifier presence. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingCancellationSmokeRegistry', () => {
  it('proof artifact and verifier exist; latest run PASSED', () => {
    const root = path.join(__dirname, '../../..');
    expect(fs.existsSync(path.join(root, 'scripts/verify-booking-phase7b-cancellation.ts'))).toBe(
      true,
    );
    const proof = JSON.parse(
      fs.readFileSync(path.join(root, '_booking-phase7b-cancellation-proof.json'), 'utf8'),
    );
    expect(proof.passed).toBe(true);
    expect(proof.smokeRunId).toBe(69);
  });
});
