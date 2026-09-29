import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_FORBIDDEN_TABLES,
  CALENDAR_TABLE_WRITER_ALLOWLIST,
} from '../internal/calendarTableAllowlist';

function listSourceFiles(rootRel: string, skipTests = true): string[] {
  const root = path.join(process.cwd(), rootRel);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipTests && entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

function normalizePath(file: string): string {
  return path.relative(process.cwd(), file).replace(/\\/g, '/');
}

describe('DRVO-006 operational calendar import boundaries', () => {
  it('new apps code does not directly reference forbidden calendar tables', () => {
    const allowSet = new Set<string>(CALENDAR_TABLE_WRITER_ALLOWLIST);
    const appFiles = [
      ...listSourceFiles('src/apps/booking'),
      ...listSourceFiles('src/apps/queue'),
    ];
    for (const file of appFiles) {
      const rel = normalizePath(file);
      if (allowSet.has(rel)) continue;
      const content = fs.readFileSync(file, 'utf8');
      for (const table of CALENDAR_FORBIDDEN_TABLES) {
        expect(content.includes(table), `${rel} must not reference ${table}`).toBe(false);
      }
    }
  });

  it('forbidden table fixture is detectable', () => {
    const fixture = path.join(
      process.cwd(),
      'src/shared/operational-calendar/__tests__/fixtures/forbidden-calendar-table.fixture.ts',
    );
    expect(fs.readFileSync(fixture, 'utf8')).toContain('TblShiftMove');
  });
});
