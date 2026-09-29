import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkImportBoundaries } from '@/platform/internal/importBoundaries';

function fixture(rel: string): string {
  return path.join(process.cwd(), rel);
}

function listQueueSourceFiles(): string[] {
  const root = path.join(process.cwd(), 'src/apps/queue');
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

describe('DRVO-005 queue import boundaries', () => {
  it('queue package does not import apps/booking', () => {
    const violations = checkImportBoundaries([
      fixture('src/apps/queue/__tests__/fixtures/cross-app-public.fixture.ts'),
    ]);
    expect(
      violations.some((v) => v.rule === 'apps must not import another app directly'),
    ).toBe(true);
  });

  it('production queue tree has no cross-app imports', () => {
    const violations = checkImportBoundaries(listQueueSourceFiles());
    expect(violations).toEqual([]);
  });

  it('queue package does not take sp_getapplock', () => {
    for (const file of listQueueSourceFiles()) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content.includes('sp_getapplock'), `${file} must not take applocks`).toBe(false);
    }
  });

  it('extracted queue code does not reference forbidden financial tables', () => {
    const forbidden = ['TblinvServHead', 'TblCashMove'];
    for (const file of listQueueSourceFiles()) {
      const content = fs.readFileSync(file, 'utf8');
      for (const table of forbidden) {
        expect(content.includes(table), `${file} must not reference ${table}`).toBe(false);
      }
    }
  });

  it('detects forbidden table fixture for boundary scans', () => {
    const content = fs.readFileSync(
      fixture('src/apps/queue/__tests__/fixtures/forbidden-table-query.fixture.ts'),
      'utf8',
    );
    expect(content).toContain('TblinvServHead');
    expect(content).toContain('TblCashMove');
  });
});
