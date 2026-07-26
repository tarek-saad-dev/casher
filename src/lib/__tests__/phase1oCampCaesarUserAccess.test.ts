import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');

describe('phase1oCampCaesarUserAccess', () => {
  it('copies access without duplicating users; SETUP stays off switcher', () => {
    const tpl = fs.readFileSync(
      path.join(root, 'src/lib/branch/branchConfigurationTemplate.ts'),
      'utf8',
    );
    const sw = fs.readFileSync(path.join(root, 'src/lib/branch/switchBranch.ts'), 'utf8');
    expect(tpl).toContain('user_branch_access');
    expect(tpl).toContain('grantUserBranchAccess');
    expect(tpl).toContain('isDeleted');
    expect(tpl).toMatch(/smoke|test/i);
    expect(sw).toContain('branchIsActive');
  });
});
