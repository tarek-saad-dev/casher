import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

function accessRow(partial: Record<string, unknown>) {
  return {
    id: 1,
    userId: 10,
    branchId: 1,
    branchCode: 'A',
    branchName: 'Branch A',
    shortName: 'A',
    isDefault: false,
    canOperate: true,
    canViewReports: true,
    canSwitch: true,
    isActive: true,
    validFrom: new Date('2020-01-01'),
    validTo: null,
    branchIsActive: true,
    ...partial,
  };
}

describe('resolveLoginDefaultBranch soft resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('uses IsDefault when present', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date(),
      getUserBranchAccess: vi.fn(),
      isValidUserBranchAccess: () => true,
      listUserValidBranchAccess: vi.fn(async () => [
        accessRow({ branchId: 2, branchCode: 'B', isDefault: false }),
        accessRow({ branchId: 5, branchCode: 'GLEEM', isDefault: true }),
      ]),
    }));
    const { resolveLoginDefaultBranch } = await import('@/lib/branch/access');
    const row = await resolveLoginDefaultBranch(10);
    expect(row.branchCode).toBe('GLEEM');
  });

  it('falls back to operable branch when no IsDefault', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date(),
      getUserBranchAccess: vi.fn(),
      isValidUserBranchAccess: () => true,
      listUserValidBranchAccess: vi.fn(async () => [
        accessRow({ branchId: 9, branchCode: 'CAMP', isDefault: false, canOperate: true }),
        accessRow({ branchId: 3, branchCode: 'OTHER', isDefault: false, canOperate: false }),
      ]),
    }));
    const { resolveLoginDefaultBranch } = await import('@/lib/branch/access');
    const row = await resolveLoginDefaultBranch(10);
    expect(row.branchCode).toBe('CAMP');
  });

  it('does not error on multiple IsDefault rows', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date(),
      getUserBranchAccess: vi.fn(),
      isValidUserBranchAccess: () => true,
      listUserValidBranchAccess: vi.fn(async () => [
        accessRow({ branchId: 8, branchCode: 'B', isDefault: true }),
        accessRow({ branchId: 2, branchCode: 'A', isDefault: true }),
      ]),
    }));
    const { resolveLoginDefaultBranch } = await import('@/lib/branch/access');
    const row = await resolveLoginDefaultBranch(10);
    expect(row.branchCode).toBe('A'); // lowest branchId
  });

  it('throws NO_BRANCH_ACCESS when user has no valid rows', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      branchNow: () => new Date(),
      getUserBranchAccess: vi.fn(),
      isValidUserBranchAccess: () => true,
      listUserValidBranchAccess: vi.fn(async () => []),
    }));
    const { resolveLoginDefaultBranch } = await import('@/lib/branch/access');
    await expect(resolveLoginDefaultBranch(10)).rejects.toMatchObject({
      code: 'NO_BRANCH_ACCESS',
      name: 'BranchDomainError',
    });
  });
});
