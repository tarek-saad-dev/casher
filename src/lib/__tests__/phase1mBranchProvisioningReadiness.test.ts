import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import fs from 'fs';
import path from 'path';
import {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  isForbiddenLifecycleJump,
  isTransitionAllowed,
  isPubliclyDiscoverable,
  LIFECYCLE_CAPABILITIES,
} from '@/lib/branch/lifecycle';

const root = path.join(__dirname, '..', '..', '..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1M branch provisioning + readiness (source)', () => {
  it('migration adds lifecycle columns and smoke tables without activating PH1GTEST', () => {
    const sql = read('db/migrations/add-branch-lifecycle-phase-1m.sql');
    expect(sql).toContain('LifecycleStatus');
    expect(sql).toContain('PublicBookingEnabled');
    expect(sql).toContain('TblBranchSmokeRun');
    expect(sql).toContain('TblBranchSmokeArtifact');
    expect(sql).toContain("BranchCode = N'PH1GTEST'");
    expect(sql).toMatch(/PublicBookingEnabled\s*=\s*0/);
    expect(sql).toContain("LifecycleStatus = N'SETUP'");
    expect(sql).not.toMatch(/UPDATE dbo\.TblBranch[\s\S]{0,200}PH1GTEST[\s\S]{0,80}IsActive\s*=\s*1/i);
  });

  it('createBranchRecord forces SETUP and never enables public booking', () => {
    const boot = read('src/lib/branch/bootstrap.ts');
    expect(boot).toContain("lifecycleStatus = 'SETUP'");
    expect(boot).toContain('const isActive = false');
    expect(boot).toContain('publicBookingEnabled = false');
    expect(boot).toContain('Phase 1M non-negotiable');
  });

  it('provisionBranch rejects body lifecycle escalation fields', () => {
    const svc = read('src/lib/branch/branchProvisioningService.ts');
    expect(svc).toContain('rejectEscalationFields');
    expect(svc).toContain("'lifecycleStatus'");
    expect(svc).toContain("'publicBookingEnabled'");
    expect(svc).toContain("'isActive'");
    expect(svc).toContain('branch.provision.started');
    expect(svc).toContain('bookingEnabled: false');
  });

  it('readiness engine returns gates and blockers structure', () => {
    const svc = read('src/lib/branch/branchReadinessService.ts');
    expect(svc).toContain('isReadyForSmoke');
    expect(svc).toContain('isReadyForInternalLive');
    expect(svc).toContain('isReadyForPublicLive');
    expect(svc).toContain('payroll.plan_coverage');
    expect(svc).toContain('public.frontend_multi_branch');
    expect(svc).toContain('branch.readiness.evaluated');
  });

  it('provision API exists and uses requireBranchAdminAccess', () => {
    const route = read('src/app/api/admin/branches/provision/route.ts');
    expect(route).toContain('requireBranchAdminAccess');
    expect(route).toContain('provisionBranch');
    expect(route).toContain('SETUP');
  });

  it('admin UI create button says setup mode not Activate', () => {
    const page = read('src/app/admin/branches/new/page.tsx');
    expect(page).toContain('Create branch in setup mode');
    expect(page).not.toMatch(/>\s*Activate\s*</);
  });
});

describe('Phase 1M lifecycle FSM (pure)', () => {
  it('forbids SETUP → PUBLIC_LIVE and SMOKE → PUBLIC_LIVE', () => {
    expect(isForbiddenLifecycleJump('SETUP', 'PUBLIC_LIVE')).toBe(true);
    expect(isForbiddenLifecycleJump('SMOKE_TEST', 'PUBLIC_LIVE')).toBe(true);
    expect(isForbiddenLifecycleJump('SUSPENDED', 'PUBLIC_LIVE')).toBe(true);
    expect(isTransitionAllowed('SETUP', 'SMOKE_TEST')).toBe(true);
    expect(isTransitionAllowed('SETUP', 'PUBLIC_LIVE')).toBe(false);
  });

  it('SETUP/SMOKE keep IsActive false; live states enable ops', () => {
    expect(LIFECYCLE_CAPABILITIES.SETUP.isActive).toBe(false);
    expect(LIFECYCLE_CAPABILITIES.SMOKE_TEST.isActive).toBe(false);
    expect(LIFECYCLE_CAPABILITIES.SMOKE_TEST.publicBooking).toBe(false);
    expect(LIFECYCLE_CAPABILITIES.INTERNAL_LIVE.isActive).toBe(true);
    expect(LIFECYCLE_CAPABILITIES.INTERNAL_LIVE.publicBooking).toBe(false);
    expect(LIFECYCLE_CAPABILITIES.PUBLIC_LIVE.publicBooking).toBe(true);
  });

  it('allowed transition map has no SETUP→PUBLIC_LIVE edge', () => {
    expect(ALLOWED_LIFECYCLE_TRANSITIONS.SETUP).not.toContain('PUBLIC_LIVE');
    expect(ALLOWED_LIFECYCLE_TRANSITIONS.SMOKE_TEST).toContain('INTERNAL_LIVE');
  });

  it('public discoverability requires PUBLIC_LIVE + flags', () => {
    expect(
      isPubliclyDiscoverable({
        lifecycleStatus: 'PUBLIC_LIVE',
        publicBookingEnabled: true,
        isActive: true,
      }),
    ).toBe(true);
    expect(
      isPubliclyDiscoverable({
        lifecycleStatus: 'INTERNAL_LIVE',
        publicBookingEnabled: true,
        isActive: true,
      }),
    ).toBe(false);
    expect(
      isPubliclyDiscoverable({
        lifecycleStatus: 'SMOKE_TEST',
        publicBookingEnabled: false,
        isActive: false,
      }),
    ).toBe(false);
  });
});
