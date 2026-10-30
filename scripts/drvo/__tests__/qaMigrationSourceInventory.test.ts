/** Agent 5: source-only migration inventory gate. No database access. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRVO_MIGRATIONS } from '../migrations/index';

const root = path.join(process.cwd(), 'db/drvo-migrations');
const source = path.join(process.cwd(), 'scripts/drvo/migrations');

function numberedNames(dir: string): Array<{ id: number; name: string }> {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name.match(/^\d{3}-/) && (entry.isDirectory() || entry.isFile()))
    .map((entry) => ({ id: Number(entry.name.slice(0, 3)), name: entry.name }));
}
function duplicates(items: Array<{ id: number; name: string }>) {
  const byId = new Map<number, string[]>();
  for (const item of items) byId.set(item.id, [...(byId.get(item.id) ?? []), item.name]);
  return [...byId.entries()].filter(([, names]) => names.length > 1);
}

describe('QA migration source inventory and collision protection', () => {
  it('does not contain duplicate migration numbers in SQL or TS inventory', () => {
    expect(duplicates(numberedNames(root))).toEqual([]);
    expect(duplicates(numberedNames(source))).toEqual([]);
  });
  it('registers every SQL migration directory (except registry 000)', () => {
    const registered = new Set(DRVO_MIGRATIONS.map((m) => m.migrationId));
    const dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{3}-/.test(entry.name))
      .map((entry) => ({ id: Number(entry.name.slice(0, 3)), name: entry.name }))
      .filter((entry) => entry.id !== 0);
    expect(dirs.filter((entry) => !registered.has(entry.id))).toEqual([]);
  });
  it('does not register duplicate migration ids or keys', () => {
    expect(new Set(DRVO_MIGRATIONS.map((m) => m.migrationId)).size).toBe(DRVO_MIGRATIONS.length);
    expect(new Set(DRVO_MIGRATIONS.map((m) => m.migrationKey)).size).toBe(DRVO_MIGRATIONS.length);
  });
});
