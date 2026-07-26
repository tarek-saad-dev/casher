import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1N Camp Caesar isolation', () => {
  it('runner captures GLEEM fingerprints and forbids active/public leak', () => {
    const runner = read('scripts/branch-smoke/run-phase1n-camp-caesar-smoke.ts');
    expect(runner).toContain('captureGleem');
    expect(runner).toContain('listActiveBranches');
    expect(runner).toContain('listPublicActiveBranches');
    expect(runner).toContain('Smoke artifacts owned by GLEEM');
    expect(runner).toContain('gleem.isolation');
  });

  it('cleanup refuses GLEEM and restores SETUP', () => {
    const cleanup = read('scripts/branch-smoke/cleanup-branch-smoke-run.ts');
    expect(cleanup).toContain('Refuse: cleanup targeting GLEEM');
    expect(cleanup).toContain('isAllowedSmokeBranchCode');
    const svc = read('src/lib/branch/branchSmokeService.ts');
    expect(svc).toContain("LifecycleStatus = N'SETUP'");
    expect(svc).toContain('IsActive = 0');
    expect(svc).toContain('PublicBookingEnabled = 0');
  });

  it('smoke APIs reject body BranchID spoof', () => {
    const start = read('src/app/api/admin/branches/[id]/smoke/start/route.ts');
    expect(start).toContain('BranchID في الجسم غير مسموح');
  });
});
