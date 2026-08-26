import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1M controlled smoke isolation', () => {
  it('smoke service allows PH1GTEST/CAMP_CAESAR and refuses GLEEM', () => {
    const svc = read('src/lib/branch/branchSmokeService.ts');
    const policy = read('src/lib/branch/smokeBranchPolicy.ts');
    expect(policy).toContain('CAMP_CAESAR');
    expect(policy).toContain('PH1GTEST');
    expect(policy).toContain('ALLOWED_SMOKE_BRANCH_CODES');
    expect(svc).toContain('isAllowedSmokeBranchCode');
    expect(svc).toContain('GLEEM');
    expect(svc).toContain('لا يمكن تشغيل smoke على GLEEM');
    expect(svc).toContain('Cleanup يرفض BranchID الخاص بـ GLEEM');
    expect(svc).toContain('ExternalSideEffectsEnabled');
    expect(svc).toContain('branch.smoke.started');
    expect(svc).toContain('branch.smoke.cleanup.completed');
    expect(svc).toContain("LifecycleStatus = N'SETUP'");
    expect(svc).toContain("liveBranch?.lifecycleStatus === 'SMOKE_TEST'");
    expect(svc).toContain('INTERNAL_LIVE / PUBLIC_LIVE must never be deactivated');
    expect(svc).toContain('branch.smoke.cleanup.skip_demote_public_live');
    expect(svc).toContain("AND LifecycleStatus = N'SMOKE_TEST'");
    expect(svc).toContain('ISNULL(PublicBookingEnabled, 0) = 0');
  });

  it('cleanup script refuses GLEEM and requires SmokeRunID', () => {
    const script = read('scripts/branch-smoke/cleanup-branch-smoke-run.ts');
    expect(script).toContain('SmokeRunID');
    expect(script).toMatch(/PH1GTEST|CAMP_CAESAR|isAllowedSmokeBranchCode/);
    expect(script).toContain('GLEEM');
    expect(script).toContain('refuse');
  });

  it('smoke APIs require admin and reject body BranchID spoof', () => {
    const start = read('src/app/api/admin/branches/[id]/smoke/start/route.ts');
    expect(start).toContain('requireBranchAdminAccess');
    expect(start).toContain('BranchID في الجسم غير مسموح');

    const cleanup = read(
      'src/app/api/admin/branches/[id]/smoke/[runId]/cleanup/route.ts',
    );
    expect(cleanup).toContain('cleanupBranchSmokeRun');
    expect(cleanup).toContain('BranchID في الجسم غير مسموح');
  });
});
