import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  BRANCH_OWNED_ROUTE_MARKERS,
  DOMAIN_OWNERSHIP_REGISTRY,
  GO_LIVE_BLOCKER_DOMAINS,
} from '@/lib/branch/domainOwnershipRegistry';

const root = path.join(__dirname, '..', '..', '..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1I multibranch boundaries', () => {
  it('registry covers required ownership classes and go-live blockers', () => {
    const classes = new Set(DOMAIN_OWNERSHIP_REGISTRY.map((d) => d.classification));
    expect(classes.has('GLOBAL_MASTER')).toBe(true);
    expect(classes.has('BRANCH_OWNED_ROOT')).toBe(true);
    expect(classes.has('HYBRID_GLOBAL_IDENTITY_BRANCH_ACTIVITY')).toBe(true);
    expect(classes.has('DEFERRED_REQUIRES_BUSINESS_DECISION')).toBe(true);
    expect(classes.has('INACTIVE_LEGACY')).toBe(true);
    expect(classes.has('DEVICE_OR_DEPLOYMENT_LOCAL')).toBe(true);
    expect(classes.has('EMPLOYEE_GLOBAL_CONFLICT')).toBe(true);

    expect(GO_LIVE_BLOCKER_DOMAINS).not.toContain('attendance');
    expect(GO_LIVE_BLOCKER_DOMAINS).not.toContain('payroll_ledger_targets');
    // Phase 1J cleared inventory/purchases blockers
    expect(GO_LIVE_BLOCKER_DOMAINS).not.toContain('inventory_stock');
    expect(GO_LIVE_BLOCKER_DOMAINS).not.toContain('purchases');
    // Phase 1K cleared attendance blocker (payroll attribution remains 1L)
  });

  it('every BRANCH_OWNED_ROUTE_MARKER file contains its ownership assertion', () => {
    for (const m of BRANCH_OWNED_ROUTE_MARKERS) {
      const src = read(m.path);
      expect(src, m.path).toContain(m.mustContain);
    }
  });

  it('P0 day/shift status routes no longer use unscoped Status=1 open day', () => {
    const status = read('src/app/api/operations/status/route.ts');
    expect(status).toContain('requireActiveBranchContext');
    expect(status).toContain('getOpenBusinessDay');
    expect(status).not.toMatch(
      /FROM \[dbo\]\.\[TblNewDay\]\s+WHERE Status = 1\s+ORDER BY/i,
    );

    const rollover = read('src/app/api/day/rollover-check/route.ts');
    expect(rollover).toContain('requireActiveBranchContext');
    expect(rollover).toContain('getOpenBusinessDay');

    const today = read('src/app/api/sales/today/route.ts');
    expect(today).toMatch(/WHERE Status = 1 AND BranchID = @branchId/);
  });

  it('queue settings never falls back to unscoped TOP 1', () => {
    const src = read('src/app/api/queue/settings/route.ts');
    expect(src).toContain('WHERE BranchID = @branchId');
    expect(src).not.toMatch(
      /SELECT TOP 1 \* FROM \[dbo\]\.\[QueueBookingSettings\] ORDER BY SettingID DESC/,
    );
  });

  it('sales WhatsApp uses session branch name (not silent جليم default)', () => {
    const src = read('src/app/api/sales/route.ts');
    expect(src).toContain('branchName: gated.branch.branchName');
  });

  it('owner daily WhatsApp iterates active branches instead of preferring GLEEM', () => {
    const src = read('src/lib/hr/owner-daily-whatsapp-report.service.ts');
    expect(src).toContain('listActiveBranches');
    expect(src).toContain('resolveOwnerReportBranchIds');
    expect(src).not.toContain("getBranchByCode('GLEEM')");
  });

  it('day/shift summary IDOR paths validate ownership before returning data', () => {
    expect(read('src/app/api/day/summary/route.ts')).toContain(
      'validateBusinessDayBelongsToBranch',
    );
    expect(read('src/app/api/shift/summary/route.ts')).toContain(
      'validateShiftBelongsToBranch',
    );
    expect(read('src/app/api/day/summary/route.ts')).toContain('financialNotFoundResponse');
    expect(read('src/app/api/shift/summary/route.ts')).toContain('financialNotFoundResponse');
  });

  it('Phase 1I documentation set exists', () => {
    const docs = [
      'docs/branch-phase-1i-feature-inventory.md',
      'docs/branch-phase-1i-database-ownership-matrix.md',
      'docs/branch-phase-1i-shared-vs-owned-contract.md',
      'docs/branch-phase-1i-inventory-and-assets.md',
      'docs/branch-phase-1i-hr-payroll-boundary.md',
      'docs/branch-phase-1i-settings-and-jobs.md',
      'docs/branch-phase-1i-risk-register.md',
      'docs/branch-phase-1i-verification.md',
      'docs/branch-phase-1i-closure.md',
    ];
    for (const d of docs) {
      expect(fs.existsSync(path.join(root, d)), d).toBe(true);
    }
  });
});
