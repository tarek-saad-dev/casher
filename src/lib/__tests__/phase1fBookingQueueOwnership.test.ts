/**
 * Phase 1F — booking/queue branch ownership unit tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

function activeBranch(partial: {
  branchId: number;
  branchCode: string;
  isActive?: boolean;
}) {
  return {
    branchId: partial.branchId,
    branchCode: partial.branchCode,
    branchName: partial.branchCode,
    shortName: null,
    address: null,
    phone: null,
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '04:00:00',
    defaultOpenTime: null,
    defaultCloseTime: null,
    isActive: partial.isActive ?? true,
    createdAt: new Date(),
    updatedAt: null,
  };
}

describe('phase1f booking queue ownership helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('extractPublicBranchCode prefers query then body', async () => {
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const q = new URLSearchParams('branchCode=GLEEM');
    expect(mod.extractPublicBranchCode(q)).toBe('GLEEM');
    expect(mod.extractPublicBranchCode(new URLSearchParams(), { branchCode: 'OTHER' })).toBe(
      'OTHER',
    );
    expect(mod.extractPublicBranchCode(new URLSearchParams())).toBeNull();
  });

  it('explicit valid branchCode resolves as before', async () => {
    const getBranchByCode = vi.fn(async (code: string) => {
      if (code.trim().toUpperCase() === 'GLEEM') {
        return activeBranch({ branchId: 1, branchCode: 'GLEEM' });
      }
      return null;
    });
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchByCode,
      listActiveBranches: vi.fn(async () => {
        throw new Error('listActiveBranches must not run for explicit code');
      }),
    }));
    vi.resetModules();
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const ok = await mod.resolvePublicBranchCode('gleem');
    expect(ok.branchId).toBe(1);
    expect(getBranchByCode).toHaveBeenCalledWith('gleem');
  });

  it('explicit invalid branchCode fails as before', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchByCode: vi.fn(async () => null),
      listActiveBranches: vi.fn(async () => []),
    }));
    vi.resetModules();
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    await expect(mod.resolvePublicBranchCode('UNKNOWN')).rejects.toMatchObject({
      code: 'BRANCH_INACTIVE',
    });
  });

  it('explicit inactive branchCode fails', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchByCode: vi.fn(async () =>
        activeBranch({ branchId: 9, branchCode: 'DEAD', isActive: false }),
      ),
      listActiveBranches: vi.fn(async () => []),
    }));
    vi.resetModules();
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    await expect(mod.resolvePublicBranchCode('DEAD')).rejects.toMatchObject({
      code: 'BRANCH_INACTIVE',
    });
  });

  it('missing branchCode + exactly one active public branch → uses that branch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const only = activeBranch({ branchId: 7, branchCode: 'SOLE' });
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchByCode: vi.fn(async () => {
        throw new Error('getBranchByCode must not run when code missing');
      }),
      listActiveBranches: vi.fn(async () => [only]),
    }));
    vi.resetModules();
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const resolved = await mod.resolvePublicBranchCode(null, {
      route: '/api/public/booking/services',
    });
    expect(resolved).toMatchObject({ branchId: 7, branchCode: 'SOLE' });
    expect(warn).toHaveBeenCalledWith(
      '[public-booking] single-active-branch compatibility fallback',
      {
        route: '/api/public/booking/services',
        resolvedBranchID: 7,
        resolvedBranchCode: 'SOLE',
      },
    );
    warn.mockRestore();
  });

  it('missing branchCode + empty/blank also uses single-active fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchByCode: vi.fn(),
      listActiveBranches: vi.fn(async () => [
        activeBranch({ branchId: 3, branchCode: 'ONLY' }),
      ]),
    }));
    vi.resetModules();
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const a = await mod.resolvePublicBranchCode('');
    const b = await mod.resolvePublicBranchCode('   ');
    expect(a.branchCode).toBe('ONLY');
    expect(b.branchCode).toBe('ONLY');
    warn.mockRestore();
  });

  it('missing branchCode + two active public branches → BRANCH_REQUIRED', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchByCode: vi.fn(),
      listActiveBranches: vi.fn(async () => [
        activeBranch({ branchId: 1, branchCode: 'A' }),
        activeBranch({ branchId: 2, branchCode: 'B' }),
      ]),
    }));
    vi.resetModules();
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const { BranchDomainError } = await import('@/lib/branch/types');
    await expect(mod.resolvePublicBranchCode(null)).rejects.toMatchObject({
      code: 'BRANCH_REQUIRED',
    });
    await expect(mod.resolvePublicBranchCode(undefined)).rejects.toBeInstanceOf(
      BranchDomainError,
    );
  });

  it('missing branchCode + zero active branches → fail closed BRANCH_REQUIRED', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchByCode: vi.fn(),
      listActiveBranches: vi.fn(async () => []),
    }));
    vi.resetModules();
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    await expect(mod.resolvePublicBranchCode(null)).rejects.toMatchObject({
      code: 'BRANCH_REQUIRED',
    });
  });

  it('assertBookingOwnedByActiveBranch is strict', async () => {
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    expect(mod.assertBookingOwnedByActiveBranch(1, 1)).toBe(true);
    expect(mod.assertBookingOwnedByActiveBranch(1, 2)).toBe(false);
    expect(mod.assertBookingOwnedByActiveBranch(1, null)).toBe(false);
  });

  it('toPublicBranchSafe omits internal fields', async () => {
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const safe = mod.toPublicBranchSafe({
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم – سابا باشا',
      shortName: 'جليم',
      address: 'addr',
      phone: '01',
      timeZone: 'Africa/Cairo',
      businessDayCutoffTime: '04:00:00',
      defaultOpenTime: '10:00',
      defaultCloseTime: '02:00',
      isActive: true,
      createdAt: new Date(),
      updatedAt: null,
    });
    expect(safe).toEqual({
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم – سابا باشا',
      shortName: 'جليم',
      address: 'addr',
      phone: '01',
      timeZone: 'Africa/Cairo',
    });
    expect(safe).not.toHaveProperty('businessDayCutoffTime');
    expect(safe).not.toHaveProperty('isActive');
  });

  it('public branch error responses include CORS headers', async () => {
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const required = mod.publicBranchRequiredResponse();
    const invalid = mod.publicInvalidBranchResponse();
    expect(required.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(invalid.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(required.status).toBe(400);
    expect(invalid.status).toBe(404);
  });
});

describe('phase1f public booking single-branch fallback contracts', () => {
  const ownershipSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/branch/bookingQueueOwnership.ts'),
    'utf8',
  );

  const publicBookingRoutes = [
    'config',
    'services',
    'barbers',
    'available-days',
    'available-slots',
    'check-slot',
    'plan',
    'create',
    'upcoming',
  ];

  it('resolver has no hardcoded GLEEM fallback', () => {
    const resolveFn = ownershipSrc.slice(
      ownershipSrc.indexOf('export async function resolvePublicBranchCode'),
    );
    const body = resolveFn.slice(0, resolveFn.indexOf('\nexport function extractPublicBranchCode'));
    expect(body).not.toMatch(/['"]GLEEM['"]/);
    expect(body).not.toMatch(/branchCode\s*\|\|\s*['"]/);
    expect(body).not.toMatch(/PH1GTEST/);
    expect(body).not.toMatch(/BranchID\s*=\s*1/);
    expect(body).not.toMatch(/TOP\s+1/i);
  });

  it('missing-code path requires exactly one active branch (not TOP 1)', () => {
    expect(ownershipSrc).toContain('active.length === 1');
    expect(ownershipSrc).toContain(
      '[public-booking] single-active-branch compatibility fallback',
    );
    expect(ownershipSrc).toContain('listActiveBranches');
  });

  it('does not activate PH1GTEST or mutate branch data', () => {
    const resolveFn = ownershipSrc.slice(
      ownershipSrc.indexOf('export async function resolvePublicBranchCode'),
    );
    const body = resolveFn.slice(0, resolveFn.indexOf('\nexport function extractPublicBranchCode'));
    expect(body).not.toMatch(/UPDATE\s+dbo\.TblBranch/i);
    expect(body).not.toMatch(/SET\s+IsActive/i);
    expect(body).not.toMatch(/PH1GTEST/);
    expect(ownershipSrc).not.toMatch(/UPDATE\s+dbo\.TblBranch/i);
  });

  it('services, barbers, upcoming (and all public booking routes) use the same resolver', () => {
    for (const route of publicBookingRoutes) {
      const src = fs.readFileSync(
        path.join(process.cwd(), `src/app/api/public/booking/${route}/route.ts`),
        'utf8',
      );
      expect(src).toContain('resolvePublicBranchCode');
      expect(src).toContain(`route: '/api/public/booking/${route}'`);
      // No per-route silent GLEEM / TOP 1 fallback
      expect(src).not.toMatch(/branchCode\s*\|\|\s*['"]GLEEM['"]/);
      expect(src).not.toMatch(/SELECT\s+TOP\s+1/i);
    }
  });
});

describe('phase1f source contracts', () => {
  it('queue ticket code SQL scopes by BranchID', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/queueTicketCode.ts'),
      'utf8',
    );
    expect(src).toContain('BranchID = @branchId AND QueueDate = @qDate');
    expect(src).toContain('UPDLOCK, HOLDLOCK');
  });

  it('settings cache key is branch-scoped', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/publicBookingHelpers.ts'),
      'utf8',
    );
    expect(src).toContain('__pos_public_settings_cache_by_branch_v1');
    expect(src).toContain('WHERE BranchID = @branchId');
  });

  it('busy interval builders remain employee-global (no BranchID filter)', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/queueEstimateEngine.ts'),
      'utf8',
    );
    const bookingFn = src.slice(src.indexOf('export async function buildBookingIntervals'));
    const bookingBody = bookingFn.slice(0, bookingFn.indexOf('export async function', 10));
    expect(bookingBody).toContain('AssignedEmpID');
    expect(bookingBody).not.toMatch(/BranchID\s*=\s*@/);

    const queueFn = src.slice(src.indexOf('export async function buildQueueIntervals'));
    const queueBody = queueFn.slice(0, 2500);
    expect(queueBody).toContain('EmpID');
    // Conflict queries must not filter occupancy to a single branch
    expect(queueBody).not.toMatch(/AND\s+qt\.BranchID\s*=/);
  });

  it('migration preserves global booking code and replaces queue uniqueness', () => {
    const sqlText = fs.readFileSync(
      path.join(process.cwd(), 'db/migrations/add-booking-queue-branch-ownership.sql'),
      'utf8',
    );
    expect(sqlText).toContain("BranchCode = N'GLEEM'");
    expect(sqlText).toContain('UX_Bookings_BookingCode');
    expect(sqlText).toContain('UQ_QueueTickets_Branch_Date_Code');
    expect(sqlText).toContain('DROP CONSTRAINT UQ_QueueTickets_Code_Date');
    expect(sqlText).toContain('UQ_QueueBookingSettings_BranchID');
  });

  it('public branches route exists', () => {
    expect(
      fs.existsSync(path.join(process.cwd(), 'src/app/api/public/branches/route.ts')),
    ).toBe(true);
  });

  it('flow board filters by BranchID and returns activeBranch', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/operations/flow-board/route.ts'),
      'utf8',
    );
    expect(src).toContain('AND b.BranchID = @branchId');
    expect(src).toContain('AND qt.BranchID = @branchId');
    expect(src).toContain('activeBranch');
  });

  it('convert asserts booking branch equals session branch', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/bookings/[id]/convert/route.ts'),
      'utf8',
    );
    expect(src).toContain('assertBookingOwnedByActiveBranch');
    expect(src).toContain('bookingQueueNotFoundResponse');
  });
});
