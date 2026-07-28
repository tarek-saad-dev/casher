/** Phase 10A — Camp Shizar activation + Ahmed assignment contracts. */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

describe('bookingPhase10aCampShizarActivation', () => {
  it('has activation + dual-branch smoke scripts with rollback', () => {
    const act = fs.readFileSync(
      path.join(process.cwd(), 'scripts/phase10a-activate-camp-shizar.ts'),
      'utf8',
    );
    const smoke = fs.readFileSync(
      path.join(process.cwd(), 'scripts/verify-booking-phase10a-dual-branch-smoke.ts'),
      'utf8',
    );
    const pre = fs.readFileSync(
      path.join(process.cwd(), 'scripts/phase10a-preflight.ts'),
      'utf8',
    );
    expect(act).toContain('CAMP_CAESAR');
    expect(act).toContain('AHMED_EMP_ID = 18');
    expect(act).toContain('PUBLIC_LIVE');
    expect(act).toContain('_phase10a-rollback.sql');
    expect(act).toContain('IsActive = 0');
    expect(act).not.toContain('DELETE FROM dbo.TblEmpBranchAssignment');
    expect(smoke).toContain('CAMP_CAESAR');
    expect(smoke).toContain('AHMED');
    expect(smoke).toContain('idempotentReplay');
    expect(pre).toContain('EXPECTED_AHMED');
  });

  it('readiness multi-branch gates are env-verified not hard-fail forever', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/branch/branchReadinessService.ts'),
      'utf8',
    );
    expect(src).toContain('PUBLIC_BOOKING_MULTI_BRANCH_VERIFIED');
    expect(src).toContain('multiBranchVerified');
  });

  it('financial ownership verifier allows Camp PUBLIC_LIVE after 10A', () => {
    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        'scripts/verify-employee-financial-branch-ownership.ts',
      ),
      'utf8',
    );
    expect(src).not.toContain("CAMP_CAESAR must not be PUBLIC_LIVE");
    expect(src).toContain('PUBLIC_LIVE allowed after Phase 10A');
  });

  it('records dual-branch smoke artifact when present', () => {
    const artifact = path.join(
      process.cwd(),
      '_booking-phase10a-dual-branch-smoke.json',
    );
    if (!fs.existsSync(artifact)) return;
    const j = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    expect(j.phase).toBe('booking-phase-10a-dual-branch-smoke');
    expect(j.passed).toBe(true);
    expect(j.proofs.branches.hasCamp).toBe(true);
    expect(j.proofs.barbers.campHasAhmed).toBe(true);
    expect(j.proofs.barbers.gleemHasAhmed).toBe(false);
    expect(j.proofs.services.campNotPublic).toBe(false);
    expect(JSON.stringify(j)).not.toMatch(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\./);
  });
});
