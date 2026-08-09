import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');

describe('user create grants multi-branch access', () => {
  it('POST /api/users grants all active branches', () => {
    const route = fs.readFileSync(
      path.join(root, 'src/app/api/users/route.ts'),
      'utf8',
    );
    expect(route).toContain('grantStaffAccessToAllActiveBranches');
    expect(route).toContain('BranchID');
  });

  it('login resolver no longer hard-fails on missing IsDefault', () => {
    const access = fs.readFileSync(
      path.join(root, 'src/lib/branch/access.ts'),
      'utf8',
    );
    expect(access).not.toContain('NO_DEFAULT_BRANCH');
    expect(access).not.toContain('MULTIPLE_DEFAULT_BRANCHES');
    expect(access).toContain('NO_BRANCH_ACCESS');
  });

  it('users admin UI explains free branch switching', () => {
    const page = fs.readFileSync(
      path.join(root, 'src/app/admin/users/page.tsx'),
      'utf8',
    );
    expect(page).toContain('فرع البداية');
    expect(page).toContain('BranchID: fBranchID');
  });
});
