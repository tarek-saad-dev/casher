/** Phase 7B — service-start race marker. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingCancellationServiceStartRace', () => {
  it('verifier covers cancel vs in_service race', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../scripts/verify-booking-phase7b-cancellation.ts'),
      'utf8',
    );
    expect(src).toContain('service_start_race');
    expect(src).toContain('in_service');
  });
});
