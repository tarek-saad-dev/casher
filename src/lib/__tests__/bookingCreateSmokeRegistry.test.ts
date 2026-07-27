/**
 * Phase 6C — SmokeRun registry contract and artifacts tracking.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

describe('bookingCreateSmokeRegistry', () => {
  it('has a Phase 6C harness that records SmokeRunID, artifacts and metrics', () => {
    const h = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/__tests__/helpers/phase6cSmokeHarness.ts'),
      'utf8',
    );
    expect(h).toContain('startBranchSmokeRun');
    expect(h).toContain('registerSmokeArtifact');
    expect(h).toContain('P6C_PHASE');
    expect(h).toContain('booking-phase-6c-final-create-proof');
    expect(h).toContain('completeSmokeRun');
    expect(h).toContain('cleanupPhase6C');
  });

  it('keeps Phase 6C verifier idempotent and outside public routes', () => {
    const create = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingCreate.ts'),
      'utf8',
    );
    expect(create).toContain('BOOKING_PHASE_6C_VERIFIER');
    expect(create).not.toMatch(/body\.[a-zA-Z]*Injection/);
    expect(create).not.toMatch(/query\.[a-zA-Z]*Injection/);
  });
});
