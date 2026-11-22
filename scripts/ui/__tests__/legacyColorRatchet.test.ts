import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanLegacyClasses } from '../legacy-classes.mjs';
import { compareToBaseline, countLegacy } from '../legacy-color-report.mjs';

describe('legacy colour ratchet', () => {
  it('detects dark-era palette classes but not DRVO tokens', () => {
    const hits = scanLegacyClasses(
      'className="bg-zinc-900 text-amber-400/80 hover:text-white border-white/10 bg-card text-primary text-success"',
    );
    expect(hits.map((h: { token: string }) => h.token)).toEqual([
      'bg-zinc-900',
      'text-amber-400/80',
      'hover:text-white',
      'border-white/10',
    ]);
  });

  it('flags any file that grows beyond its baseline', () => {
    expect(compareToBaseline({ 'a.tsx': 3, 'b.tsx': 1 }, { 'a.tsx': 3 })).toEqual([
      { file: 'b.tsx', allowed: 0, actual: 1 },
    ]);
    expect(compareToBaseline({ 'a.tsx': 2 }, { 'a.tsx': 3 })).toEqual([]);
  });

  it('the codebase does not exceed the committed baseline', () => {
    const baseline = JSON.parse(readFileSync(join(process.cwd(), 'scripts/ui/legacy-color-baseline.json'), 'utf8'));
    expect(compareToBaseline(countLegacy(), baseline)).toEqual([]);
  });

  it('migrated shell + UI kit files contain no legacy colour classes', () => {
    const counts = countLegacy();
    for (const file of [
      'src/components/layout/MainNav.tsx',
      'src/components/layout/AuthenticatedAppShell.tsx',
      'src/components/session/ActiveSessionBar.tsx',
      'src/components/ui/button.tsx',
      'src/components/ui/badge.tsx',
      'src/components/ui/status-pill.tsx',
      'src/components/ui/select.tsx',
      'src/components/ui/checkbox.tsx',
      'src/components/shared/PageHeader.tsx',
      'src/components/shared/EmptyState.tsx',
      'src/components/shared/KpiCard.tsx',
      'src/app/income/pos/page.tsx',
    ]) {
      expect(counts[file] ?? 0, file).toBe(0);
    }
  });
});
