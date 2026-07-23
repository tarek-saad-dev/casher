/**
 * Phase 1E unit tests — branch report scope resolution (no live DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

describe('Phase 1E reportScope — pure helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('reportScopeToCacheKey builds a stable key for single scope', async () => {
    const { reportScopeToCacheKey } = await import('@/lib/branch/reportScope');
    const key = reportScopeToCacheKey({
      mode: 'single',
      branchId: 5,
      branchCode: 'GLEEM',
      branchName: 'Gleem',
      shortName: null,
    });
    expect(key).toBe('single:5');
  });

  it('reportScopeToCacheKey sorts branchIds for all-branches scope', async () => {
    const { reportScopeToCacheKey } = await import('@/lib/branch/reportScope');
    const key = reportScopeToCacheKey({
      mode: 'all',
      branchIds: [3, 1, 2],
      branches: [],
    });
    expect(key).toBe('all:1,2,3');
  });

  it('reportScopeMetadata shapes single-branch scope', async () => {
    const { reportScopeMetadata } = await import('@/lib/branch/reportScope');
    const meta = reportScopeMetadata({
      mode: 'single',
      branchId: 5,
      branchCode: 'GLEEM',
      branchName: 'Gleem',
      shortName: 'GL',
    });
    expect(meta).toEqual({
      mode: 'single',
      branch: { BranchID: 5, BranchCode: 'GLEEM', BranchName: 'Gleem', ShortName: 'GL' },
    });
  });

  it('reportScopeMetadata shapes all-branches scope', async () => {
    const { reportScopeMetadata } = await import('@/lib/branch/reportScope');
    const meta = reportScopeMetadata({
      mode: 'all',
      branchIds: [1, 2],
      branches: [
        { branchId: 1, branchCode: 'A', branchName: 'Alpha', shortName: null },
        { branchId: 2, branchCode: 'B', branchName: 'Beta', shortName: 'BT' },
      ],
    });
    expect(meta).toEqual({
      mode: 'all',
      branches: [
        { BranchID: 1, BranchCode: 'A', BranchName: 'Alpha', ShortName: null },
        { BranchID: 2, BranchCode: 'B', BranchName: 'Beta', ShortName: 'BT' },
      ],
    });
  });

  it('isReportBranchScope distinguishes scope objects from NextResponse', async () => {
    const { isReportBranchScope } = await import('@/lib/branch/reportScope');
    const scope = { mode: 'single' as const, branchId: 1, branchCode: 'A', branchName: 'A', shortName: null };
    expect(isReportBranchScope(scope)).toBe(true);
    expect(isReportBranchScope(NextResponse.json({ error: 'x' }, { status: 403 }))).toBe(false);
  });

  it('parseReportScopeQuery reads scope=all (case-insensitive) and branchId', async () => {
    const { parseReportScopeQuery } = await import('@/lib/branch/reportScope');
    expect(parseReportScopeQuery(new URLSearchParams('scope=ALL'))).toEqual({
      requestedBranchId: null,
      requestedAllBranches: true,
    });
    expect(parseReportScopeQuery(new URLSearchParams('scope=all_branches'))).toEqual({
      requestedBranchId: null,
      requestedAllBranches: true,
    });
    expect(parseReportScopeQuery(new URLSearchParams('branchId=7'))).toEqual({
      requestedBranchId: 7,
      requestedAllBranches: false,
    });
  });

  it('parseReportScopeQuery ignores invalid/non-positive branchId values', async () => {
    const { parseReportScopeQuery } = await import('@/lib/branch/reportScope');
    expect(parseReportScopeQuery(new URLSearchParams('branchId=abc')).requestedBranchId).toBeNull();
    expect(parseReportScopeQuery(new URLSearchParams('branchId=-1')).requestedBranchId).toBeNull();
    expect(parseReportScopeQuery(new URLSearchParams('branchId=0')).requestedBranchId).toBeNull();
    expect(parseReportScopeQuery(new URLSearchParams('branchId=3.5')).requestedBranchId).toBeNull();
  });
});

describe('Phase 1E reportScope — resolveReportBranchScope (mocked context/repository)', () => {
  const ACTIVE_CTX = {
    userId: 1,
    branchId: 10,
    branchCode: 'GLEEM',
    branchName: 'Gleem',
    shortName: 'GL',
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '04:00:00',
    canOperate: true,
    canViewReports: true,
    canSwitch: false,
  };

  beforeEach(() => {
    vi.resetModules();
  });

  it('defaults to the active session branch when no branchId is requested', async () => {
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: (v: unknown) =>
        !(v instanceof NextResponse) && typeof (v as { branchId?: unknown }).branchId === 'number',
      requireActiveBranchContext: vi.fn(async () => ACTIVE_CTX),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date('2026-07-22T00:00:00Z'),
      getBranchById: vi.fn(),
      listActiveBranches: vi.fn(),
      listUserValidBranchAccess: vi.fn(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(),
    }));

    const { resolveReportBranchScope, isReportBranchScope } = await import('@/lib/branch/reportScope');
    const scope = await resolveReportBranchScope({ requestedBranchId: null, requestedAllBranches: false });
    expect(isReportBranchScope(scope)).toBe(true);
    if (isReportBranchScope(scope)) {
      expect(scope).toEqual({
        mode: 'single',
        branchId: 10,
        branchCode: 'GLEEM',
        branchName: 'Gleem',
        shortName: 'GL',
      });
    }
  });

  it('denies single-branch access when the active branch lacks CanViewReports', async () => {
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: (v: unknown) =>
        !(v instanceof NextResponse) && typeof (v as { branchId?: unknown }).branchId === 'number',
      requireActiveBranchContext: vi.fn(async () => ({ ...ACTIVE_CTX, canViewReports: false })),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date('2026-07-22T00:00:00Z'),
      getBranchById: vi.fn(),
      listActiveBranches: vi.fn(),
      listUserValidBranchAccess: vi.fn(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(),
    }));

    const { resolveReportBranchScope, isReportBranchScope } = await import('@/lib/branch/reportScope');
    const scope = await resolveReportBranchScope({ requestedBranchId: null, requestedAllBranches: false });
    expect(isReportBranchScope(scope)).toBe(false);
    if (!isReportBranchScope(scope)) {
      expect(scope.status).toBe(403);
      const body = await scope.json();
      expect(body.code).toBe('REPORT_NOT_ALLOWED');
    }
  });

  it('rejects scope=all when allowAllBranchesIfPermitted is not set', async () => {
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: (v: unknown) =>
        !(v instanceof NextResponse) && typeof (v as { branchId?: unknown }).branchId === 'number',
      requireActiveBranchContext: vi.fn(async () => ACTIVE_CTX),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date('2026-07-22T00:00:00Z'),
      getBranchById: vi.fn(),
      listActiveBranches: vi.fn(),
      listUserValidBranchAccess: vi.fn(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(),
    }));

    const { resolveReportBranchScope, isReportBranchScope } = await import('@/lib/branch/reportScope');
    const scope = await resolveReportBranchScope({ requestedBranchId: null, requestedAllBranches: true });
    expect(isReportBranchScope(scope)).toBe(false);
    if (!isReportBranchScope(scope)) {
      expect(scope.status).toBe(403);
      const body = await scope.json();
      expect(body.code).toBe('ALL_BRANCHES_DENIED');
    }
  });

  it('returns all-branches scope sorted by branchId when caller has full coverage', async () => {
    const activeBranches = [
      { branchId: 1, branchCode: 'A', branchName: 'Alpha', shortName: null, isActive: true },
      { branchId: 2, branchCode: 'B', branchName: 'Beta', shortName: null, isActive: true },
    ];
    const authorizedAccess = [
      {
        branchId: 2,
        branchCode: 'B',
        branchName: 'Beta',
        shortName: null,
        canViewReports: true,
        isActive: true,
        branchIsActive: true,
      },
      {
        branchId: 1,
        branchCode: 'A',
        branchName: 'Alpha',
        shortName: null,
        canViewReports: true,
        isActive: true,
        branchIsActive: true,
      },
    ];

    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: (v: unknown) =>
        !(v instanceof NextResponse) && typeof (v as { branchId?: unknown }).branchId === 'number',
      requireActiveBranchContext: vi.fn(async () => ACTIVE_CTX),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date('2026-07-22T00:00:00Z'),
      getBranchById: vi.fn(),
      listActiveBranches: vi.fn(async () => activeBranches),
      listUserValidBranchAccess: vi.fn(async () => authorizedAccess),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(),
    }));

    const { resolveReportBranchScope, isReportBranchScope } = await import('@/lib/branch/reportScope');
    const scope = await resolveReportBranchScope({
      requestedBranchId: null,
      requestedAllBranches: true,
      allowAllBranchesIfPermitted: true,
    });
    expect(isReportBranchScope(scope)).toBe(true);
    if (isReportBranchScope(scope)) {
      expect(scope.mode).toBe('all');
      if (scope.mode === 'all') {
        expect(scope.branchIds).toEqual([1, 2]);
      }
    }
  });

  it('denies all-branches scope when the caller is missing CanViewReports on one active branch', async () => {
    const activeBranches = [
      { branchId: 1, branchCode: 'A', branchName: 'Alpha', shortName: null, isActive: true },
      { branchId: 2, branchCode: 'B', branchName: 'Beta', shortName: null, isActive: true },
    ];
    // Only branch 1 is authorized — branch 2 is missing from the caller's access list.
    const authorizedAccess = [
      {
        branchId: 1,
        branchCode: 'A',
        branchName: 'Alpha',
        shortName: null,
        canViewReports: true,
        isActive: true,
        branchIsActive: true,
      },
    ];

    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: (v: unknown) =>
        !(v instanceof NextResponse) && typeof (v as { branchId?: unknown }).branchId === 'number',
      requireActiveBranchContext: vi.fn(async () => ACTIVE_CTX),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date('2026-07-22T00:00:00Z'),
      getBranchById: vi.fn(),
      listActiveBranches: vi.fn(async () => activeBranches),
      listUserValidBranchAccess: vi.fn(async () => authorizedAccess),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(),
    }));

    const { resolveReportBranchScope, isReportBranchScope } = await import('@/lib/branch/reportScope');
    const scope = await resolveReportBranchScope({
      requestedBranchId: null,
      requestedAllBranches: true,
      allowAllBranchesIfPermitted: true,
    });
    expect(isReportBranchScope(scope)).toBe(false);
    if (!isReportBranchScope(scope)) {
      expect(scope.status).toBe(403);
      const body = await scope.json();
      expect(body.code).toBe('ALL_BRANCHES_INCOMPLETE_ACCESS');
    }
  });
});
