import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 1B migration artifacts', () => {
  const root = process.cwd();
  const sqlPath = path.join(root, 'db/migrations/add-multi-branch-foundation.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  it('creates only the three foundation tables', () => {
    expect(sql).toContain('TblBranch');
    expect(sql).toContain('TblUserBranchAccess');
    expect(sql).toContain('TblEmpBranchAssignment');
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+.*ADD\s+.*BranchID/i);
    expect(sql).toMatch(/Does NOT modify TblNewDay/);
    expect(sql).toMatch(/Does NOT modify[\s\S]*TblShiftMove/);
    expect(sql).not.toMatch(/UPDATE\s+.*TblNewDay/i);
    expect(sql).not.toMatch(/UPDATE\s+.*TblShiftMove/i);
    expect(sql).not.toMatch(/UPDATE\s+.*TblCashMove/i);
    expect(sql).not.toMatch(/UPDATE\s+.*TblinvServHead/i);
  });

  it('seeds GLEEM by BranchCode and never assumes BranchID = 1', () => {
    expect(sql).toContain("BranchCode] = N'GLEEM'");
    expect(sql).toContain("N'GLEEM'");
    expect(sql).toContain('جليم – سابا باشا');
    expect(sql).toMatch(/never assume BranchID = 1/i);
    expect(sql).not.toMatch(/WHERE\s+BranchID\s*=\s*1/i);
    expect(sql).not.toMatch(/VALUES\s*\(\s*1\s*,\s*N'GLEEM'/i);
  });

  it('backfills current users and active employees only', () => {
    expect(sql).toContain('ISNULL(u.isDeleted, 0) = 0');
    expect(sql).toContain('ISNULL(e.isActive, 1) = 1');
    expect(sql).toContain('NOT EXISTS');
  });

  it('runner and verifier scripts exist', () => {
    expect(
      fs.existsSync(path.join(root, 'scripts/run-multi-branch-foundation-migration.ts')),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, 'scripts/verify-multi-branch-foundation.ts'))).toBe(
      true,
    );
  });
});
