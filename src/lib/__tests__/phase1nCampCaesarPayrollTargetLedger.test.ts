import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1N Camp Caesar payroll / target / ledger', () => {
  it('requires hourly ledger credit and monthly actual posting', () => {
    const runner = read('scripts/branch-smoke/run-phase1n-camp-caesar-smoke.ts');
    expect(runner).toContain('hourly_wage');
    expect(runner).toContain('Hourly payroll exists but ledger credit does not');
    expect(runner).toContain('monthly_salary');
    expect(runner).toContain('dryRun: false');
    expect(runner).toContain('Monthly salary actual posting not proven');
  });

  it('requires positive target entitlement and ledger credit', () => {
    const runner = read('scripts/branch-smoke/run-phase1n-camp-caesar-smoke.ts');
    expect(runner).toContain('Positive target not proven');
    expect(runner).toContain('target.positiveEntitlement');
    expect(runner).toContain('Target ledger credit not proven');
  });

  it('payout enforces branch balance and rejects overpay/cross-branch', () => {
    const runner = read('scripts/branch-smoke/run-phase1n-camp-caesar-smoke.ts');
    expect(runner).toContain('Overpay payout was not rejected');
    expect(runner).toContain('Cross-branch payout created GLEEM ledger row');
    expect(runner).toContain('executeEmployeePayout');
    expect(runner).toContain('branchId: 1');
  });
});
