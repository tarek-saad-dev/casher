import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkImportBoundaries } from '@/platform/internal/importBoundaries';

describe('DRVO import boundaries', () => {
  it('passes for the current module tree (excluding fixture)', () => {
    const violations = checkImportBoundaries();
    expect(violations).toEqual([]);
  });

  it('detects the forbidden fixture import', () => {
    const fixture = path.join(
      process.cwd(),
      'src/platform/__tests__/fixtures/forbidden-import.fixture.ts',
    );
    const violations = checkImportBoundaries([fixture]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.rule.includes('platform must not import'))).toBe(
      true,
    );
  });
});
