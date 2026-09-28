import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkImportBoundaries } from '@/platform/internal/importBoundaries';

function fixture(rel: string): string {
  return path.join(process.cwd(), rel);
}

function listBookingSourceFiles(): string[] {
  const root = path.join(process.cwd(), 'src/apps/booking');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

describe('DRVO-004 booking import boundaries', () => {
  it('booking package does not import apps/pos', () => {
    const violations = checkImportBoundaries([
      fixture('src/apps/booking/__tests__/fixtures/forbidden-pos-import.fixture.ts'),
    ]);
    expect(
      violations.some((v) => v.rule === 'apps must not import another app directly'),
    ).toBe(true);
  });

  it('production booking tree has no cross-app imports', () => {
    const violations = checkImportBoundaries(listBookingSourceFiles());
    expect(violations).toEqual([]);
  });

  it('extracted booking code does not reference forbidden POS/Treasury/Queue tables', () => {
    const forbidden = ['TblinvServHead', 'TblCashMove', 'QueueTickets'];
    for (const file of listBookingSourceFiles()) {
      const content = fs.readFileSync(file, 'utf8');
      for (const table of forbidden) {
        expect(content.includes(table), `${file} must not reference ${table}`).toBe(false);
      }
    }
  });

  it('detects forbidden table fixture for boundary scans', () => {
    const content = fs.readFileSync(
      fixture('src/apps/booking/__tests__/fixtures/forbidden-table-query.fixture.ts'),
      'utf8',
    );
    expect(content).toContain('TblinvServHead');
    expect(content).toContain('TblCashMove');
  });
});
