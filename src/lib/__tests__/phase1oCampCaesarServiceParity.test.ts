import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
const tpl = fs.readFileSync(
  path.join(root, 'src/lib/branch/branchConfigurationTemplate.ts'),
  'utf8',
);

describe('phase1oCampCaesarServiceParity', () => {
  it('uses global catalog parity — no transactional copy', () => {
    expect(tpl).toContain('auditGlobalServiceParity');
    expect(tpl).toContain('GLOBAL_TBLPRO_SHARED');
    expect(tpl).toContain('mismatchCount: 0');
    expect(tpl).not.toContain('INSERT INTO dbo.TblPro');
    expect(tpl).toContain('Deleted/inactive services were not reactivated');
  });
});
