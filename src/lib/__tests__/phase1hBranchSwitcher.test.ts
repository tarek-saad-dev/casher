/**
 * Phase 1H unit tests — secure active-branch session switching (mocked DB /
 * mocked session module, no live connection, no real cookie APIs) + source
 * contract checks for the switch-branch route, client helpers, and registry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

type AccessRowOverrides = Partial<{
  id: number;
  userId: number;
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  isDefault: boolean;
  canOperate: boolean;
  canViewReports: boolean;
  canSwitch: boolean;
  isActive: boolean;
  validFrom: Date;
  validTo: Date | null;
  branchIsActive: boolean;
}>;

function accessRow(overrides: AccessRowOverrides = {}) {
  return {
    id: 1,
    userId: 10,
    branchId: 1,
    branchCode: 'GLEEM',
    branchName: 'جليم – سابا باشا',
    shortName: 'جليم',
    isDefault: true,
    canOperate: true,
    canViewReports: true,
    canSwitch: false,
    isActive: true,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: null,
    branchIsActive: true,
    ...overrides,
  };
}

function branchRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    branchId: 1,
    branchCode: 'GLEEM',
    branchName: 'جليم – سابا باشا',
    shortName: 'جليم',
    address: null,
    phone: null,
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '05:00:00',
    defaultOpenTime: null,
    defaultCloseTime: null,
    isActive: true,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: null,
    ...overrides,
  };
}

function sessionUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    UserID: 10,
    UserName: 'Cashier',
    UserLevel: 'user',
    ActiveBranchID: 1,
    ActiveBranchCode: 'GLEEM',
    BranchSessionVersion: 1,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────
// listSwitchableBranchesForUser
// ────────────────────────────────────────────────────────────────
describe('Phase 1H — listSwitchableBranchesForUser (mocked repository)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('includes only CanOperate=true rows on active branches, excludes inactive branch, marks current', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({
        exists: true,
        isDeleted: false,
        userName: 'Cashier',
        userLevel: 'user',
      })),
      listUserValidBranchAccess: vi.fn(async () => [
        accessRow({ branchId: 1, branchCode: 'GLEEM', canOperate: true, branchIsActive: true }),
        accessRow({
          branchId: 2,
          branchCode: 'PH1GTEST',
          canOperate: true,
          isDefault: false,
          branchIsActive: false, // inactive branch — must be excluded even though CanOperate=1
        }),
        accessRow({
          branchId: 3,
          branchCode: 'NOACCESS',
          canOperate: false, // no operate permission — must be excluded
          isDefault: false,
        }),
      ]),
    }));

    const { listSwitchableBranchesForUser } = await import('@/lib/branch/switchBranch');
    const result = await listSwitchableBranchesForUser(10, 1);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ branchId: 1, branchCode: 'GLEEM', isCurrent: true });
  });

  it('marks the branch matching currentBranchId as current even when it sorts second', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({
        exists: true,
        isDeleted: false,
        userName: 'Cashier',
        userLevel: 'user',
      })),
      listUserValidBranchAccess: vi.fn(async () => [
        accessRow({ branchId: 1, branchCode: 'AAAA', canOperate: true, isDefault: false }),
        accessRow({ branchId: 2, branchCode: 'BBBB', canOperate: true, isDefault: false }),
      ]),
    }));

    const { listSwitchableBranchesForUser } = await import('@/lib/branch/switchBranch');
    const result = await listSwitchableBranchesForUser(10, 2);

    expect(result.map((b) => b.branchId)).toEqual([2, 1]); // current sorts first
    expect(result.find((b) => b.branchId === 2)?.isCurrent).toBe(true);
    expect(result.find((b) => b.branchId === 1)?.isCurrent).toBe(false);
  });

  it('throws USER_DELETED (401) for a soft-deleted or missing user', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({
        exists: true,
        isDeleted: true,
        userName: 'Gone',
        userLevel: 'user',
      })),
      listUserValidBranchAccess: vi.fn(async () => []),
    }));

    const { listSwitchableBranchesForUser } = await import('@/lib/branch/switchBranch');
    await expect(listSwitchableBranchesForUser(10, 1)).rejects.toMatchObject({
      code: 'USER_DELETED',
      status: 401,
    });
  });
});

// ────────────────────────────────────────────────────────────────
// resolvePostSwitchNavigationPath
// ────────────────────────────────────────────────────────────────
describe('Phase 1H — resolvePostSwitchNavigationPath', () => {
  it('redirects previous-branch entity-detail URLs to /', async () => {
    const { resolvePostSwitchNavigationPath } = await import('@/lib/branch/postSwitchNavigation');
    const unsafe = [
      '/operations/bookings/123',
      '/bookings/45',
      '/sales/9',
      '/queue/7',
      '/income/9',
      '/expenses/3',
      '/incomes/1',
    ];
    for (const p of unsafe) {
      expect(resolvePostSwitchNavigationPath(p)).toBe('/');
    }
  });

  it('keeps safe non-entity paths such as /income/pos unchanged', async () => {
    const { resolvePostSwitchNavigationPath } = await import('@/lib/branch/postSwitchNavigation');
    expect(resolvePostSwitchNavigationPath('/income/pos')).toBe('/income/pos');
    expect(resolvePostSwitchNavigationPath('/operations')).toBe('/operations');
    expect(resolvePostSwitchNavigationPath('/queue')).toBe('/queue');
  });

  it('strips query strings and defaults null/undefined/empty to /', async () => {
    const { resolvePostSwitchNavigationPath } = await import('@/lib/branch/postSwitchNavigation');
    expect(resolvePostSwitchNavigationPath('/income/pos?tab=cash')).toBe('/income/pos');
    expect(resolvePostSwitchNavigationPath(null)).toBe('/');
    expect(resolvePostSwitchNavigationPath(undefined)).toBe('/');
    expect(resolvePostSwitchNavigationPath('')).toBe('/');
  });
});

// ────────────────────────────────────────────────────────────────
// switchActiveBranch — mocked session + repository + access + audit
// ────────────────────────────────────────────────────────────────
function mockSwitchDeps(opts: {
  verified?: { ok: true } | { ok: false; reason: string };
  session?: Record<string, unknown> | null;
  userStatus?: { exists: boolean; isDeleted: boolean; userName: string | null; userLevel: string | null };
  branchesById?: Record<number, ReturnType<typeof branchRecord> | null>;
  access?: { canOperate: boolean } | 'throw-no-access';
  createSessionImpl?: () => Promise<void>;
}) {
  const createSession = vi.fn(opts.createSessionImpl ?? (async () => undefined));
  const auditWrite = vi.fn(async () => 1);

  vi.doMock('@/lib/session', () => ({
    verifySessionCookie: vi.fn(async () => opts.verified ?? { ok: true }),
    getSession: vi.fn(async () => opts.session ?? sessionUser()),
    createSession,
  }));

  vi.doMock('@/lib/branch/repository', () => ({
    getUserActiveStatus: vi.fn(
      async () =>
        opts.userStatus ?? {
          exists: true,
          isDeleted: false,
          userName: 'Cashier',
          userLevel: 'user',
        },
    ),
    getBranchById: vi.fn(async (id: number) => {
      const table = opts.branchesById ?? {};
      return id in table ? table[id] : branchRecord({ branchId: id });
    }),
    listUserValidBranchAccess: vi.fn(async () => []),
  }));

  vi.doMock('@/lib/branch/access', () => ({
    validateUserBranchAccess: vi.fn(async () => {
      if (opts.access === 'throw-no-access') {
        const { BranchDomainError } = await import('@/lib/branch/types');
        throw new BranchDomainError('NO_BRANCH_ACCESS', 'no access', 403);
      }
      return { canOperate: (opts.access ?? { canOperate: true }).canOperate };
    }),
  }));

  vi.doMock('@/lib/sensitiveActionAudit', () => ({
    writeSensitiveAuditEvent: auditWrite,
  }));

  return { createSession, auditWrite };
}

describe('Phase 1H — switchActiveBranch (mocked session/DB, no live cookie APIs)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('succeeds and reissues the session for a CanOperate=true target branch', async () => {
    const { createSession, auditWrite } = mockSwitchDeps({
      session: sessionUser({ ActiveBranchID: 1, ActiveBranchCode: 'GLEEM' }),
      branchesById: { 2: branchRecord({ branchId: 2, branchCode: 'BR2', isActive: true }) },
      access: { canOperate: true },
    });

    const { switchActiveBranch } = await import('@/lib/branch/switchBranch');
    const result = await switchActiveBranch({ branchId: 2 });

    expect(result).toMatchObject({ ok: true, changed: true, activeBranch: { branchId: 2, branchCode: 'BR2' } });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ ActiveBranchID: 2, ActiveBranchCode: 'BR2', BranchSessionVersion: 1 }),
    );
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'BRANCH_SESSION_SWITCH', executionStatus: 'success' }),
    );
  });

  it('denies the switch when CanOperate=false, never reissues the cookie, and audits the denial', async () => {
    const { createSession, auditWrite } = mockSwitchDeps({
      session: sessionUser({ ActiveBranchID: 1, ActiveBranchCode: 'GLEEM' }),
      branchesById: { 2: branchRecord({ branchId: 2, branchCode: 'BR2', isActive: true }) },
      access: { canOperate: false },
    });

    const { switchActiveBranch } = await import('@/lib/branch/switchBranch');
    const result = await switchActiveBranch({ branchId: 2 });

    expect(result).toMatchObject({ ok: false, status: 403, code: 'BRANCH_ACCESS_DENIED' });
    expect(createSession).not.toHaveBeenCalled();
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'BRANCH_SESSION_SWITCH_DENIED', executionStatus: 'failed' }),
    );
  });

  it('denies the switch when the user has no branch-access row at all (non-disclosing 403)', async () => {
    const { createSession } = mockSwitchDeps({
      session: sessionUser({ ActiveBranchID: 1, ActiveBranchCode: 'GLEEM' }),
      branchesById: { 2: branchRecord({ branchId: 2, branchCode: 'BR2', isActive: true }) },
      access: 'throw-no-access',
    });

    const { switchActiveBranch } = await import('@/lib/branch/switchBranch');
    const result = await switchActiveBranch({ branchId: 2 });

    expect(result).toMatchObject({ ok: false, status: 403, code: 'BRANCH_ACCESS_DENIED' });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects unknown/inactive target branches with a 404 (same code for both — non-disclosing)', async () => {
    mockSwitchDeps({
      session: sessionUser({ ActiveBranchID: 1, ActiveBranchCode: 'GLEEM' }),
      branchesById: { 2: null },
    });
    const { switchActiveBranch } = await import('@/lib/branch/switchBranch');
    const missing = await switchActiveBranch({ branchId: 2 });
    expect(missing).toMatchObject({ ok: false, status: 404, code: 'BRANCH_NOT_FOUND' });

    vi.resetModules();
    mockSwitchDeps({
      session: sessionUser({ ActiveBranchID: 1, ActiveBranchCode: 'GLEEM' }),
      branchesById: { 2: branchRecord({ branchId: 2, branchCode: 'BR2', isActive: false }) },
    });
    const { switchActiveBranch: switchActiveBranch2 } = await import('@/lib/branch/switchBranch');
    const inactive = await switchActiveBranch2({ branchId: 2 });
    expect(inactive).toMatchObject({ ok: false, status: 404, code: 'BRANCH_NOT_FOUND' });
  });

  it('returns idempotent success without reissuing the cookie or auditing when switching to the current branch', async () => {
    const { createSession, auditWrite } = mockSwitchDeps({
      session: sessionUser({ ActiveBranchID: 1, ActiveBranchCode: 'GLEEM' }),
      branchesById: { 1: branchRecord({ branchId: 1, branchCode: 'GLEEM', isActive: true }) },
    });

    const { switchActiveBranch } = await import('@/lib/branch/switchBranch');
    const result = await switchActiveBranch({ branchId: 1 });

    expect(result).toMatchObject({ ok: true, changed: false, activeBranch: { branchId: 1, branchCode: 'GLEEM' } });
    expect(createSession).not.toHaveBeenCalled();
    expect(auditWrite).not.toHaveBeenCalled();
  });

  it('rejects when the session cookie fails verification (no DB/session mutation)', async () => {
    const { createSession } = mockSwitchDeps({
      verified: { ok: false, reason: 'missing' },
    });

    const { switchActiveBranch } = await import('@/lib/branch/switchBranch');
    const result = await switchActiveBranch({ branchId: 2 });

    expect(result).toMatchObject({ ok: false, status: 401, code: 'SESSION_INVALID' });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects a soft-deleted user even with a still-valid cookie', async () => {
    mockSwitchDeps({
      session: sessionUser(),
      userStatus: { exists: true, isDeleted: true, userName: 'Gone', userLevel: 'user' },
    });

    const { switchActiveBranch } = await import('@/lib/branch/switchBranch');
    const result = await switchActiveBranch({ branchId: 2 });

    expect(result).toMatchObject({ ok: false, status: 401, code: 'USER_DELETED' });
  });

  it('rejects a non-finite / non-positive branchId as 400 INVALID_BRANCH', async () => {
    mockSwitchDeps({ session: sessionUser() });
    const { switchActiveBranch } = await import('@/lib/branch/switchBranch');
    const result = await switchActiveBranch({ branchId: 0 });
    expect(result).toMatchObject({ ok: false, status: 400, code: 'INVALID_BRANCH' });
  });
});

// ────────────────────────────────────────────────────────────────
// Source contracts (no live DB) — Phase 1H switcher wiring
// ────────────────────────────────────────────────────────────────
describe('Phase 1H — source contracts (no live DB)', () => {
  const root = process.cwd();
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

  it('the switch-branch and branches Route Handlers exist and use the switchBranch module', () => {
    expect(fs.existsSync(path.join(root, 'src/app/api/auth/switch-branch/route.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/app/api/auth/branches/route.ts'))).toBe(true);

    const switchRoute = read('src/app/api/auth/switch-branch/route.ts');
    expect(switchRoute).toContain("from '@/lib/branch/switchBranch'");
    expect(switchRoute).toMatch(/switchActiveBranch\(/);

    const branchesRoute = read('src/app/api/auth/branches/route.ts');
    expect(branchesRoute).toContain("from '@/lib/branch/switchBranch'");
    expect(branchesRoute).toMatch(/listSwitchableBranchesForUser\(/);
  });

  it('CanOperate is required to switch — switchBranch.ts gates on access.canOperate', () => {
    const src = read('src/lib/branch/switchBranch.ts');
    expect(src).toMatch(/if\s*\(!access\.canOperate\)/);
    expect(src).toContain("code: 'BRANCH_ACCESS_DENIED'");
    // No admin-level bypass of the CanOperate gate.
    expect(src).not.toMatch(/UserLevel\s*===\s*['"]admin['"][\s\S]{0,120}canOperate/);
  });

  it('switchBranch.ts never mutates TblUserBranchAccess.IsDefault (no DB write access at all)', () => {
    const src = read('src/lib/branch/switchBranch.ts');
    // The module never imports the DB layer, so it cannot issue any SQL —
    // including an UPDATE ... SET IsDefault. It only reads via ./repository
    // and ./access, and reissues the session cookie via createSession.
    expect(src).not.toMatch(/from ['"]@\/lib\/db['"]/);
    expect(src).not.toMatch(/getPool\(/);
    expect(src).not.toMatch(/\.query\(/);
    expect(src).not.toMatch(/SET\s+IsDefault/i);
  });

  it('switchBranch.ts reissues the session via createSession and audits via writeSensitiveAuditEvent', () => {
    const src = read('src/lib/branch/switchBranch.ts');
    expect(src).toContain("from '@/lib/sensitiveActionAudit'");
    expect(src).toContain('writeSensitiveAuditEvent');
    expect(src).toContain('createSession(');
  });

  it('BranchSwitcher wires performBranchSwitch, and postSwitchClient performs a hard navigation via window.location.assign', () => {
    const switcherSrc = read('src/components/session/BranchSwitcher.tsx');
    expect(switcherSrc).toContain("from '@/lib/branch/postSwitchClient'");
    expect(switcherSrc).toContain('performBranchSwitch');

    const clientSrc = read('src/lib/branch/postSwitchClient.ts');
    expect(clientSrc).toContain('window.location.assign');
  });

  it('no post-switch flow relies on router.refresh() alone (full document navigation is mandatory)', () => {
    const switcherSrc = read('src/components/session/BranchSwitcher.tsx');
    const clientSrc = read('src/lib/branch/postSwitchClient.ts');
    // Neither file imports Next's client router at all — the switch flow
    // exclusively uses window.location.assign for a full document reload,
    // so a soft router.refresh() call is structurally impossible here.
    expect(switcherSrc).not.toMatch(/useRouter/);
    expect(clientSrc).not.toMatch(/useRouter/);
    expect(clientSrc).toContain('window.location.assign');
  });

  it('sensitive action registry has BRANCH_SESSION_SWITCH and BRANCH_SESSION_SWITCH_DENIED', () => {
    const src = read('src/lib/sensitiveActionRegistry.ts');
    expect(src).toContain('BRANCH_SESSION_SWITCH:');
    expect(src).toContain('BRANCH_SESSION_SWITCH_DENIED:');
  });

  it('the branch index barrel re-exports the Phase 1H switcher API', () => {
    const src = read('src/lib/branch/index.ts');
    expect(src).toContain('listSwitchableBranchesForUser');
    expect(src).toContain('switchActiveBranch');
    expect(src).toContain('resolvePostSwitchNavigationPath');
  });
});
