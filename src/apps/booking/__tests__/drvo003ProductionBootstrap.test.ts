import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('DRVO-003 platform bootstrap', () => {
  it('central bootstrap refuses second tenant and targets CASHER_BOOT', () => {
    const bootstrap = fs.readFileSync(
      path.join(process.cwd(), 'scripts/drvo/platformBootstrap.ts'),
      'utf8',
    );
    const types = fs.readFileSync(path.join(process.cwd(), 'scripts/drvo/types.ts'), 'utf8');
    expect(types).toContain("export const PRODUCTION_DB = 'last132'");
    expect(bootstrap).toContain("export const BOOTSTRAP_TENANT_CODE = 'CASHER_BOOT'");
    expect(bootstrap).toContain('second tenant forbidden');
  });
});
