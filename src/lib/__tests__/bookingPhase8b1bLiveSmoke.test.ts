/** Phase 8B1B — live smoke registry. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingPhase8b1bLiveSmoke', () => {
  it('has controlled live smoke verifier with redaction and cancel proof', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/verify-booking-phase8b1b-live-smoke.ts'),
      'utf8',
    );
    expect(src).toContain('booking-phase-8b1b-live-smoke');
    expect(src).toContain('redactToken');
    expect(src).toContain('idempotent_replay');
    expect(src).toContain('slot_released');
    expect(src).toContain('CAMP_CAESAR');
    expect(src).not.toContain('PUBLIC_BOOKING_CONTRACT_MODE=enforce');
  });

  it('records live smoke artifact when present', () => {
    const artifact = path.join(process.cwd(), '_booking-phase8b1b-live-smoke.json');
    if (!fs.existsSync(artifact)) return;
    const j = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    expect(j.phase).toBe('booking-phase-8b1b-live-smoke');
    expect(j.passed).toBe(true);
    expect(j.proofs.create_ok).toBe(true);
    expect(j.proofs.idempotent_replay).toBe(true);
    expect(j.proofs.cancel_ok).toBe(true);
    expect(JSON.stringify(j)).not.toMatch(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\./);
  });
});
