import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('DRVO-008 POS port wiring', () => {
  it('POST /api/sales uses extracted POS path when flag is on', () => {
    const route = read('src/app/api/sales/route.ts');
    expect(route).toContain('isPosPortEnabled');
    expect(route).toContain('createSale');
    expect(route).toContain('createSaleLegacyFromRoute');
  });

  it('PATCH/DELETE /api/sales/[id] use extracted POS mutations when flag is on', () => {
    const route = read('src/app/api/sales/[id]/route.ts');
    expect(route).toContain('isPosPortEnabled');
    expect(route).toContain('updateSale');
    expect(route).toContain('deleteSale');
    expect(route).toContain('getSaleSnapshot');
  });
});
