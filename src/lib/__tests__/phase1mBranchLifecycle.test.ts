import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import fs from 'fs';
import path from 'path';
import {
  isForbiddenLifecycleJump,
  isTransitionAllowed,
} from '@/lib/branch/lifecycle';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1M branch lifecycle transitions', () => {
  it('transition service re-evaluates readiness and audits', () => {
    const svc = read('src/lib/branch/branchLifecycleTransition.ts');
    expect(svc).toContain('evaluateBranchReadiness');
    expect(svc).toContain('isForbiddenLifecycleJump');
    expect(svc).toContain('TblBranchLifecycleAudit');
    expect(svc).toContain('PH1GTEST');
    expect(svc).toContain('PUBLIC_LIVE');
    expect(svc).toContain('SmokeRunID مطلوب');
    expect(svc).toContain('branch.lifecycle.transition.completed');
    expect(svc).toContain('branch.lifecycle.transition.blocked');
  });

  it('API rejects body BranchID mismatch and requires reason', () => {
    const route = read(
      'src/app/api/admin/branches/[id]/lifecycle-transition/route.ts',
    );
    expect(route).toContain('requireBranchAdminAccess');
    expect(route).toContain('BranchID في الجسم غير مسموح');
    expect(route).toContain('transitionBranchLifecycle');
  });

  it('FSM pure rules match contract', () => {
    expect(isTransitionAllowed('INTERNAL_LIVE', 'PUBLIC_LIVE')).toBe(true);
    expect(isForbiddenLifecycleJump('SETUP', 'PUBLIC_LIVE')).toBe(true);
    expect(isTransitionAllowed('SUSPENDED', 'PUBLIC_LIVE')).toBe(false);
  });

  it('readiness UI disables activation when blockers exist', () => {
    const page = read('src/app/admin/branches/[id]/readiness/page.tsx');
    expect(page).toContain('!readiness.isReadyForSmoke');
    expect(page).toContain('!readiness.isReadyForInternalLive');
    expect(page).toContain('!readiness.isReadyForPublicLive');
    expect(page).toContain('لا يوجد تجاوز من الواجهة');
  });
});
