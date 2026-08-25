/**
 * Phase 3 — fast operational bootstrap + frontend state consolidation.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  BOOTSTRAP_REVALIDATE_DEBOUNCE_MS,
  mapBootstrapToSessionShapes,
  shouldSkipBootstrapRevalidate,
} from '@/lib/operations/bootstrapClient';
import { buildOperationalRevision } from '@/modules/operations/domain/bootstrapTypes';
import type { OperationalBootstrap } from '@/modules/operations/domain/bootstrapTypes';

const root = path.join(__dirname, '..', '..', '..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function sampleBootstrap(): OperationalBootstrap {
  return {
    user: { userId: 7, userName: 'saad', userLevel: 'admin', defaultShiftId: 1 },
    permissions: ['pos.sell'],
    access: {
      roles: ['admin'],
      isSuperAdmin: false,
      isPartnerOnly: false,
      defaultLandingPath: '/income/pos',
      allowedPagePaths: ['/income/pos'],
      allowedPageKeys: ['pos'],
    },
    branches: [
      {
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        isCurrent: true,
        canOperate: true,
      },
    ],
    activeBranch: {
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      shortName: 'جليم',
      timeZone: 'Africa/Cairo',
      businessDayCutoffTime: '04:00:00',
      canOperate: true,
      canViewReports: true,
      canSwitch: true,
    },
    operational: {
      branch: {
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
      },
      businessDay: { id: 10, branchId: 1, businessDate: '2026-08-25', status: true },
      shift: {
        id: 100,
        branchId: 1,
        businessDayId: 10,
        newDay: '2026-08-25',
        userId: 7,
        shiftId: 1,
        startTime: '10:00 AM',
        status: true,
        userName: 'saad',
        shiftName: 'صباحي',
      },
      shiftOnOtherBranch: null,
    },
    view: {
      branch: {
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
      },
      businessDay: { id: 10, branchId: 1, businessDate: '2026-08-25', status: true },
    },
    activeBranchState: {
      businessDay: { id: 10, branchId: 1, businessDate: '2026-08-25', status: true },
      openShiftCount: 1,
    },
    stale: false,
    needsRollover: false,
    expectedBusinessDate: '2026-08-25',
    reconciliationError: null,
    reconciliationAction: 'NO_OP',
    revision: '1:1:10:1:100:1:0',
    dbRoundTrips: 1,
  };
}

describe('Phase 3 bootstrap client helpers', () => {
  it('deduplicates focus revalidation inside the debounce window', () => {
    const started = 1_000_000;
    expect(shouldSkipBootstrapRevalidate(null, started + 10)).toBe(false);
    expect(shouldSkipBootstrapRevalidate(started, started + 500)).toBe(true);
    expect(shouldSkipBootstrapRevalidate(started, started + BOOTSTRAP_REVALIDATE_DEBOUNCE_MS)).toBe(false);
    expect(shouldSkipBootstrapRevalidate(started, started + BOOTSTRAP_REVALIDATE_DEBOUNCE_MS + 1)).toBe(false);
  });

  it('maps bootstrap DTO onto the existing session shapes', () => {
    const mapped = mapBootstrapToSessionShapes(sampleBootstrap());
    expect(mapped.user.UserID).toBe(7);
    expect(mapped.day?.ID).toBe(10);
    expect(mapped.shift?.ID).toBe(100);
    expect(mapped.activeBranch.branchId).toBe(1);
  });

  it('builds a stable revision from day/shift/branch', () => {
    expect(
      buildOperationalRevision({
        viewBranchId: 1,
        operationalBranchId: 1,
        businessDayId: 10,
        businessDayStatus: true,
        shiftId: 100,
        shiftStatus: true,
        stale: false,
      }),
    ).toBe('1:1:10:1:100:1:0');
  });
});

describe('Phase 3 frontend consolidation (source)', () => {
  it('SessionProvider loads bootstrap once and does not poll day/shift every 60s', () => {
    const src = read('src/components/session/SessionProvider.tsx');
    expect(src).toContain("/api/operations/bootstrap");
    expect(src).not.toMatch(/setInterval\([^)]*60_000/);
    expect(src).not.toMatch(/setInterval\(refresh,\s*60_000\)/);
    expect(src).toContain("addEventListener('focus'");
    expect(src).toContain("addEventListener('visibilitychange'");
    expect(src).toContain("addEventListener('online'");
    expect(src).toContain('shouldSkipBootstrapRevalidate');
  });

  it('initial provider load uses a single bootstrap call path', () => {
    const src = read('src/components/session/SessionProvider.tsx');
    const fetches = src.match(/fetch\('\/api\/operations\/bootstrap'/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(src).not.toMatch(/fetch\('\/api\/auth\/session'\s*,\s*\{\s*cache/);
    expect(src).toContain("method: 'DELETE'");
  });

  it('login success bootstraps without a follow-up session GET', () => {
    const src = read('src/app/login/page.tsx');
    expect(src).toContain('await refresh()');
    expect(src).not.toContain('/api/auth/session');
    expect(src).toContain('skipShiftPrompt');
    expect(src).toContain('/admin/reports/partners');
  });

  it('PermissionsProvider reads access from bootstrap session state', () => {
    const src = read('src/components/providers/PermissionsProvider.tsx');
    expect(src).toContain('session.access');
    expect(src).not.toContain('/api/permissions/my-access');
  });

  it('useDayRollover does not poll rollover-check on a timer', () => {
    const src = read('src/hooks/useDayRollover.ts');
    expect(src).not.toMatch(/setInterval/);
    expect(src).toContain('needsRollover');
  });

  it('successful open/close shift refreshes canonical bootstrap state', () => {
    const src = read('src/components/session/SessionProvider.tsx');
    expect(src).toContain('/api/shift/open');
    expect(src).toContain('/api/shift/close');
    expect(src).toContain('refreshInternal({ force: true })');
  });

  it('branch switch refreshes view context without mutating a shift; hard-nav only for entity URLs', () => {
    const switcher = read('src/components/session/BranchSwitcher.tsx');
    expect(switcher).toContain('performBranchSwitch');
    expect(switcher).toContain('onSoftSwitch');
    expect(switcher).toContain('session.refresh');
    const client = read('src/lib/branch/postSwitchClient.ts');
    expect(client).toContain('window.location.assign');
    expect(client).toContain('onSoftSwitch');
    expect(client).toContain('needsHardNavigationAfterViewSwitch');
    expect(client).not.toContain('/api/shift');
    expect(client).not.toContain('handoff');
  });

  it('compatibility session route delegates to the bootstrap read model', () => {
    const src = read('src/app/api/auth/session/route.ts');
    expect(src).toContain('loadOperationalBootstrap');
    expect(src).toContain('toLegacySessionPayload');
  });

  it('does not cache open day/shift for 60 seconds', () => {
    const loader = read('src/modules/operations/application/loadOperationalBootstrap.ts');
    const repo = read('src/modules/operations/infra/operationalBootstrapRepository.ts');
    expect(loader).not.toMatch(/60\s*\*\s*1000|60_000/);
    expect(repo).toContain('never served from a TTL cache');
    expect(read('src/app/api/operations/bootstrap/route.ts')).toContain('Cache-Control');
    expect(read('src/app/api/operations/bootstrap/route.ts')).toContain('no-store');
  });
});
