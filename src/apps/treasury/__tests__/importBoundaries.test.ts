import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CASH_MOVE_MUTATION_PATTERN,
  CASH_MOVE_WRITER_ALLOWLIST,
} from '../internal/cashMoveWriterAllowlist';

function listSourceFiles(rootRel: string): string[] {
  const root = path.join(process.cwd(), rootRel);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
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

describe('DRVO-007 TblCashMove writer boundaries', () => {
  it('documents a non-empty allowlist for grandfathered writers', () => {
    expect(CASH_MOVE_WRITER_ALLOWLIST.length).toBeGreaterThan(0);
  });

  it('migrated income/expense routes do not insert TblCashMove directly', () => {
    const allowSet = new Set<string>(CASH_MOVE_WRITER_ALLOWLIST);
    for (const rel of [
      'src/app/api/incomes/route.ts',
      'src/app/api/expenses/route.ts',
      'src/lib/actions/treasuryActions.ts',
    ]) {
      expect(allowSet.has(rel), `${rel} must not be on allowlist`).toBe(false);
      const content = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(CASH_MOVE_MUTATION_PATTERN.test(content), `${rel} must not mutate TblCashMove`).toBe(
        false,
      );
    }
  });

  it('src/app and src/lib only mutate TblCashMove through allowlisted paths', () => {
    const allowSet = new Set<string>(CASH_MOVE_WRITER_ALLOWLIST);
    const roots = ['src/app', 'src/lib'];
    const violations: string[] = [];

    for (const root of roots) {
      for (const file of listSourceFiles(root)) {
        const rel = normalizePath(file);
        if (allowSet.has(rel)) continue;
        const content = fs.readFileSync(file, 'utf8');
        if (CASH_MOVE_MUTATION_PATTERN.test(content)) {
          violations.push(rel);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
