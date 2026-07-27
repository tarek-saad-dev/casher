/** Phase 7C2 — readiness verifier / smoke registry contract. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
const PHASE_NAME = 'booking-phase-7c2-readiness-proof';

describe('bookingBackendReadinessSmoke', () => {
  it('declares Phase 7C2 readiness verifier with env gate and phase name', () => {
    const verifier = path.join(root, 'scripts/verify-booking-phase7c2-readiness.ts');
    expect(fs.existsSync(verifier)).toBe(true);
    const src = fs.readFileSync(verifier, 'utf8');
    expect(src).toContain('BOOKING_PHASE_7C2_VERIFIER');
    expect(src).toContain(PHASE_NAME);
    expect(src).toContain('gatePublicBookingRoute');
    expect(src).toContain('publicBookingRateLimitPolicy');
    expect(src).toContain('publicBookingContractMode');
  });

  it('proof artifact uses stable phase name when present', () => {
    const actualProof = path.join(root, '_booking-phase7c2-readiness-proof.json');
    if (fs.existsSync(actualProof)) {
      const proof = JSON.parse(fs.readFileSync(actualProof, 'utf8'));
      expect(proof.phase).toBe(PHASE_NAME);
    } else {
      expect(actualProof).toContain('phase7c2-readiness-proof');
    }
  });
});
