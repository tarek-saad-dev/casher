/**
 * Phase 4 — ViewBranch vs OperationalBranch + atomic shift handoff UX.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildOperationalRevision } from '@/modules/operations/domain/bootstrapTypes';
import type { OperationalBootstrap } from '@/modules/operations/domain/bootstrapTypes';
import { mapBootstrapToSessionShapes } from '@/lib/operations/bootstrapClient';
import {
  branchDisplayName,
  viewMatchesOperational,
} from '@/lib/operations/viewOperationalState';
import {
  needsHardNavigationAfterViewSwitch,
  resolvePostSwitchNavigationPath,
} from '@/lib/branch/postSwitchNavigation';

const root = path.join(__dirname, '..', '..', '..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const GLEEM = {
  branchId: 1,
  branchCode: 'GLEEM',
  branchName: 'جليم',
  shortName: 'جليم',
  timeZone: 'Africa/Cairo',
  businessDayCutoffTime: '04:00:00',
  canOperate: true,
  canViewReports: true,
  canSwitch: true,
};

const CAMP = {
  branchId: 2,
  branchCode: 'CAMP_CAESAR',
  branchName: 'كامب شيزار',
  shortName: 'كامب',
  timeZone: 'Africa/Cairo',
  businessDayCutoffTime: '04:00:00',
  canOperate: true,
  canViewReports: true,
  canSwitch: true,
};

function bootstrap(args: {
  view: typeof GLEEM;
  operational: typeof GLEEM | null;
  viewDayId?: number | null;
  shiftId?: number | null;
  shiftBranchId?: number | null;
}): OperationalBootstrap {
  const shift =
    args.shiftId != null && args.operational
      ? {
          id: args.shiftId,
          branchId: args.shiftBranchId ?? args.operational.branchId,
          businessDayId: 10,
          newDay: '2026-08-25',
          userId: 7,
          shiftId: 1,
          startTime: '10:00 AM',
          status: true,
          userName: 'saad',
          shiftName: 'صباحي',
        }
      : null;
  const viewDay =
    args.viewDayId == null
      ? null
      : {
          id: args.viewDayId,
          branchId: args.view.branchId,
          businessDate: '2026-08-25',
          status: true,
        };
  const opDay =
    shift && args.operational
      ? {
          id: shift.businessDayId,
          branchId: shift.branchId,
          businessDate: shift.newDay,
          status: true,
        }
      : null;
  const mismatch = !!(shift && args.view.branchId !== shift.branchId);

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
      { branchId: 1, branchCode: 'GLEEM', branchName: 'جليم', shortName: 'جليم', isCurrent: args.view.branchId === 1, canOperate: true },
      { branchId: 2, branchCode: 'CAMP_CAESAR', branchName: 'كامب شيزار', shortName: 'كامب', isCurrent: args.view.branchId === 2, canOperate: true },
    ],
    activeBranch: args.view,
    view: { branch: args.view, businessDay: viewDay },
    operational: {
      branch: args.operational,
      businessDay: opDay,
      shift,
      shiftOnOtherBranch: mismatch ? shift : null,
    },
    activeBranchState: { businessDay: viewDay, openShiftCount: shift ? 1 : 0 },
    stale: false,
    needsRollover: false,
    expectedBusinessDate: '2026-08-25',
    reconciliationError: null,
    reconciliationAction: 'NO_OP',
    revision: buildOperationalRevision({
      viewBranchId: args.view.branchId,
      operationalBranchId: args.operational?.branchId ?? null,
      businessDayId: viewDay?.id ?? null,
      businessDayStatus: viewDay?.status ?? null,
      shiftId: shift?.id ?? null,
      shiftStatus: shift?.status ?? null,
      stale: false,
    }),
    dbRoundTrips: 1,
  };
}

describe('Phase 4 view vs operational mapping', () => {
  it('view GLEEM + operate GLEEM maps aligned state', () => {
    const data = bootstrap({ view: GLEEM, operational: GLEEM, viewDayId: 10, shiftId: 100, shiftBranchId: 1 });
    const mapped = mapBootstrapToSessionShapes(data);
    expect(mapped.viewBranch.branchId).toBe(1);
    expect(mapped.operationalBranch?.branchId).toBe(1);
    expect(mapped.shift?.ID).toBe(100);
    expect(mapped.day?.ID).toBe(10);
    expect(viewMatchesOperational(mapped.viewBranch.branchId, mapped.operationalBranch?.branchId)).toBe(true);
  });

  it('view CAMP while operating GLEEM keeps reads on CAMP and shift on GLEEM', () => {
    const data = bootstrap({ view: CAMP, operational: GLEEM, viewDayId: 20, shiftId: 100, shiftBranchId: 1 });
    const mapped = mapBootstrapToSessionShapes(data);
    expect(mapped.viewBranch.branchCode).toBe('CAMP_CAESAR');
    expect(mapped.activeBranch.branchCode).toBe('CAMP_CAESAR');
    expect(mapped.operationalBranch?.branchCode).toBe('GLEEM');
    expect(mapped.day?.BranchID).toBe(2);
    expect(mapped.shift?.BranchID).toBe(1);
    expect(data.operational.shiftOnOtherBranch?.id).toBe(100);
    expect(viewMatchesOperational(mapped.viewBranch.branchId, mapped.operationalBranch?.branchId)).toBe(false);
  });

  it('login with OPEN GLEEM shift + default/view CAMP reports operational GLEEM', () => {
    const data = bootstrap({ view: CAMP, operational: GLEEM, viewDayId: 20, shiftId: 100, shiftBranchId: 1 });
    expect(data.view.branch.branchCode).toBe('CAMP_CAESAR');
    expect(data.operational.branch?.branchCode).toBe('GLEEM');
    expect(data.operational.shift?.id).toBe(100);
    expect(!!data.operational.shift).toBe(true);
  });

  it('no shift + select CAMP keeps start-shift targeting the view branch', () => {
    const data = bootstrap({ view: CAMP, operational: null, viewDayId: 20 });
    expect(data.view.branch.branchCode).toBe('CAMP_CAESAR');
    expect(data.operational.branch).toBeNull();
    expect(data.operational.shift).toBeNull();
    expect(data.view.businessDay?.branchId).toBe(2);
    expect(branchDisplayName(data.view.branch)).toBe('كامب');
  });

  it('revision changes when only ViewBranch changes', () => {
    const a = buildOperationalRevision({
      viewBranchId: 1,
      operationalBranchId: 1,
      businessDayId: 10,
      businessDayStatus: true,
      shiftId: 100,
      shiftStatus: true,
      stale: false,
    });
    const b = buildOperationalRevision({
      viewBranchId: 2,
      operationalBranchId: 1,
      businessDayId: 20,
      businessDayStatus: true,
      shiftId: 100,
      shiftStatus: true,
      stale: false,
    });
    expect(a).toBe('1:1:10:1:100:1:0');
    expect(b).toBe('2:1:20:1:100:1:0');
    expect(a).not.toBe(b);
  });
});

describe('Phase 4 branch-switch navigation', () => {
  it('keeps compatible routes and hard-navigates entity-owned URLs', () => {
    expect(needsHardNavigationAfterViewSwitch('/operations')).toBe(false);
    expect(resolvePostSwitchNavigationPath('/operations')).toBe('/operations');
    expect(needsHardNavigationAfterViewSwitch('/bookings/123')).toBe(true);
    expect(resolvePostSwitchNavigationPath('/bookings/123')).toBe('/');
    expect(needsHardNavigationAfterViewSwitch('/sales/9')).toBe(true);
  });
});

describe('Phase 4 source contracts', () => {
  it('bootstrap still uses one HTTP path and one core DB snapshot', () => {
    const provider = read('src/components/session/SessionProvider.tsx');
    const fetches = provider.match(/fetch\('\/api\/operations\/bootstrap'/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(provider).not.toMatch(/setInterval\([^)]*60_000/);
    expect(provider).not.toMatch(/setInterval\(refresh,\s*60_000\)/);

    const loader = read('src/modules/operations/application/loadOperationalBootstrap.ts');
    expect(loader).toContain('view:');
    expect(loader).toContain('operationalBranch');
    expect(loader).not.toContain('/api/auth/session');
    expect(loader).not.toMatch(/60\s*\*\s*1000|60_000/);

    const repo = read('src/modules/operations/infra/operationalBootstrapRepository.ts');
    expect(repo).toContain('never served from a TTL cache');
  });

  it('branch switch does not call shift mutation', () => {
    const client = read('src/lib/branch/postSwitchClient.ts');
    const switcher = read('src/lib/branch/switchBranch.ts');
    const route = read('src/app/api/auth/switch-branch/route.ts');
    expect(client).not.toContain('/api/shift');
    expect(client).not.toContain('handoff');
    expect(switcher).not.toContain('handoffShift');
    expect(switcher).not.toContain('openShift');
    expect(switcher).not.toContain('closeShift');
    expect(route).toContain('Never mutates ShiftSession');
  });

  it('handoff UX is action-gated via ShiftOperationalGateProvider', () => {
    const gate = read('src/components/session/ShiftOperationalGateProvider.tsx');
    const provider = read('src/components/session/SessionProvider.tsx');
    expect(gate).toContain('handoffMyShift');
    expect(gate).not.toContain('/api/shift/close');
    expect(gate).toContain('نقل التشغيل إلى');
    expect(gate).toContain('بدء وردية');
    expect(gate).toContain('HandoffConfirmDialog');
    expect(provider).toContain('/api/operations/shift/handoff');
    expect(provider).toContain('handoffMyShift');
  });

  it('handoff API accepts only targetBranchId and shiftId', () => {
    const src = read('src/app/api/operations/shift/handoff/route.ts');
    expect(src).toContain('handoffShift');
    expect(src).toContain('loadOperationalBootstrap');
    expect(src).toContain('targetBranchId');
    expect(src).toContain('shiftId');
    expect(src).toContain('const targetBranchId = Number(body.targetBranchId)');
    expect(src).toContain('const shiftId = Number(body.shiftId)');
    expect(src).not.toContain('body.BusinessDayID');
    expect(src).not.toContain('body.ShiftMoveID');
    expect(src).not.toContain('sourceBranchId');
    expect(src).toContain('user.UserID');
  });

  it('SessionProvider distinguishes viewBranch from operationalBranch', () => {
    const src = read('src/components/session/SessionProvider.tsx');
    expect(src).toContain('viewBranch');
    expect(src).toContain('operationalBranch');
    expect(src).toContain('hasOpenShift');
    expect(src).toContain('viewMatchesOperational');
    expect(src).not.toContain('shiftBelongsToActiveBranch');
    expect(src).toContain('handoffMyShift');
    expect(src).toContain('data.bootstrap');
  });

  it('login routes on operational.shift, not view-branch day/shift alignment', () => {
    const src = read('src/app/login/page.tsx');
    expect(src).toContain('bootstrap?.operational.shift');
    expect(src).toContain('view?.businessDay');
    expect(src).toContain('skipShiftPrompt');
    expect(src).not.toContain('/api/auth/session');
  });

  it('financial writes follow OPEN ShiftSession, not the view cookie', () => {
    const src = read('src/lib/branch/operationalGates.ts');
    expect(src).toContain("scope: 'SHIFT'");
    expect(src).toContain('getUserOpenShift');
    expect(src).toContain('toOperationalBranchContext');
    expect(src).not.toContain('an open shift on another branch must never block these');
  });

  it('shell no longer treats view/operational mismatch as an error state', () => {
    const bar = read('src/components/session/ActiveSessionBar.tsx');
    expect(bar).toContain('عرض');
    expect(bar).toContain('تعمل في');
    expect(bar).not.toContain('وردية بفرع آخر');
    expect(bar).toContain('hasOpenShift');
    expect(bar).not.toContain('onCloseDayClick');
    expect(bar).not.toContain('day.close');
  });
});
