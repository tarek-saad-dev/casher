import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');

describe('phase1oCampCaesarReadiness', () => {
  it('does not auto-transition lifecycle; keeps opening blockers', () => {
    const svc = fs.readFileSync(
      path.join(root, 'src/lib/branch/branchReadinessService.ts'),
      'utf8',
    );
    const apply = fs.readFileSync(
      path.join(root, 'scripts/branch-smoke/apply-phase1o-camp-caesar-config.ts'),
      'utf8',
    );
    expect(svc).toContain('isReadyForInternalLive');
    expect(svc).toContain('biz.opening_cash');
    expect(svc).toContain('biz.opening_inventory');
    expect(svc).toContain('biz.real_employees');
    expect(apply).toContain("LifecycleStatus !== 'SETUP'");
    expect(apply).not.toContain("ToStatus: 'INTERNAL_LIVE'");
    expect(apply).toContain('isReadyForInternalLive');
    expect(apply).toContain('INTERNAL_LIVE must remain blocked');
  });
});
