/** Phase 8C — enforce final smoke registry. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingPhase8cEnforceSmoke', () => {
  it('has enforce smoke verifier covering both journeys and rejections', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/verify-booking-phase8c-enforce-smoke.ts'),
      'utf8',
    );
    expect(src).toContain('booking-phase-8c-enforce-smoke');
    expect(src).toContain('PLAN_TOKEN_REQUIRED');
    expect(src).toContain('IDEMPOTENCY_KEY_REQUIRED');
    expect(src).toContain('any_barber');
    expect(src).toContain('specific_barber');
    expect(src).toContain('idempotentReplay');
    expect(src).toContain('CAMP_CAESAR');
    expect(src).toContain('Access-Control-Expose-Headers');
  });

  it('records enforce smoke artifact when present', () => {
    const artifact = path.join(process.cwd(), '_booking-phase8c-enforce-smoke.json');
    if (!fs.existsSync(artifact)) return;
    const j = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    expect(j.phase).toBe('booking-phase-8c-enforce-smoke');
    expect(j.passed).toBe(true);
    expect(j.proofs.enforce_active).toBe(true);
    expect(j.proofs.reject_no_planToken).toBe(true);
    expect(j.proofs.reject_no_idempotency).toBe(true);
    expect(j.proofs.reject_cancel_no_idempotency).toBe(true);
    expect(j.proofs.branch_first?.idempotentReplay).toBe(true);
    expect(j.proofs.barber_first?.idempotentReplay).toBe(true);
    expect(j.proofs.camp_caesar_hidden).toBe(true);
    expect(JSON.stringify(j)).not.toMatch(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\./);
  });
});
