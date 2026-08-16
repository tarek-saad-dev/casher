import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('treasury group-daily (super_admin consolidated)', () => {
  it('registers super_admin_only page and API guard', () => {
    const registry = read('src/lib/pages-registry.ts');
    expect(registry).toContain("path: '/treasury/group-daily'");
    expect(registry).toContain("accessMode: 'super_admin_only'");
    expect(registry).toContain('treasury.group_daily');

    const api = read('src/app/api/treasury/group-daily/route.ts');
    expect(api).toContain('isSuperAdmin');
    expect(api).toContain('loadGroupDailyTreasury');

    const service = read('src/lib/services/treasuryGroupDailyService.ts');
    expect(service).toContain('listActiveBranches');
    expect(service).toContain('CASH_SHIFT_BRANCH_MISMATCH');
    expect(service).toContain('sm.BranchID = cm.BranchID');

    const page = read('src/app/treasury/group-daily/page.tsx');
    expect(page).toContain('PageGuard');
    expect(page).toContain('/treasury/group-daily');

    const nav = read('src/components/layout/nav-config.ts');
    expect(nav).toContain('/treasury/group-daily');
    expect(nav).toContain('خزنة كل الفروع');
  });
});
