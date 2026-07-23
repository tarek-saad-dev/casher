/**
 * Phase 1F — booking/queue branch ownership unit tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

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

  it('resolvePublicBranchCode rejects missing and inactive', async () => {
    const getBranchByCode = vi.fn(async (code: string) => {
      const normalized = code.trim().toUpperCase();
      if (normalized === 'GLEEM') {
        return {
          branchId: 1,
          branchCode: 'GLEEM',
          branchName: 'جليم',
          shortName: null,
          address: null,
          phone: null,
          timeZone: 'Africa/Cairo',
          businessDayCutoffTime: '04:00:00',
          defaultOpenTime: null,
          defaultCloseTime: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: null,
        };
      }
      if (normalized === 'DEAD') {
        return {
          branchId: 9,
          branchCode: 'DEAD',
          branchName: 'x',
          shortName: null,
          address: null,
          phone: null,
          timeZone: 'Africa/Cairo',
          businessDayCutoffTime: '04:00:00',
          defaultOpenTime: null,
          defaultCloseTime: null,
          isActive: false,
          createdAt: new Date(),
          updatedAt: null,
        };
      }
      return null;
    });

    vi.doMock('@/lib/branch/repository', () => ({
      getBranchByCode,
      listActiveBranches: vi.fn(async () => []),
    }));

    vi.resetModules();
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const { BranchDomainError } = await import('@/lib/branch/types');

    await expect(mod.resolvePublicBranchCode(null)).rejects.toMatchObject({
      code: 'BRANCH_REQUIRED',
    });
    await expect(mod.resolvePublicBranchCode('')).rejects.toBeInstanceOf(BranchDomainError);
    await expect(mod.resolvePublicBranchCode('UNKNOWN')).rejects.toMatchObject({
      code: 'BRANCH_INACTIVE',
    });
    await expect(mod.resolvePublicBranchCode('DEAD')).rejects.toMatchObject({
      code: 'BRANCH_INACTIVE',
    });
    const ok = await mod.resolvePublicBranchCode('gleem');
    expect(ok.branchId).toBe(1);
    expect(getBranchByCode).toHaveBeenCalled();
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
