import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkImportBoundaries } from '@/platform/internal/importBoundaries';

function fixture(rel: string): string {
  return path.join(process.cwd(), rel);
}

describe('DRVO import boundaries', () => {
  it('passes for the current module tree (excluding fixtures)', () => {
    const violations = checkImportBoundaries();
    expect(violations).toEqual([]);
  });

  it('detects platform importing a shared domain', () => {
    const violations = checkImportBoundaries([
      fixture('src/platform/__tests__/fixtures/forbidden-import.fixture.ts'),
    ]);
    expect(violations.some((v) => v.rule.includes('platform must not import'))).toBe(true);
  });

  it('detects an app importing another app public path', () => {
    const violations = checkImportBoundaries([
      fixture('src/apps/booking/__tests__/fixtures/cross-app-public.fixture.ts'),
    ]);
    expect(
      violations.some((v) => v.rule === 'apps must not import another app directly'),
    ).toBe(true);
  });

  it('detects a shared domain importing another shared domain', () => {
    const violations = checkImportBoundaries([
      fixture('src/shared/customers/__tests__/fixtures/cross-domain.fixture.ts'),
    ]);
    expect(
      violations.some(
        (v) => v.rule === 'shared domains must not import another shared domain directly',
      ),
    ).toBe(true);
  });

  it('detects a pack importing an app internal path', () => {
    const violations = checkImportBoundaries([
      fixture('src/packs/salon/__tests__/fixtures/app-internal.fixture.ts'),
    ]);
    expect(violations.some((v) => v.rule === 'packs must not import app internal paths')).toBe(
      true,
    );
  });

  it('detects a relative pack import of an app internal path', () => {
    const violations = checkImportBoundaries([
      fixture('src/packs/salon/__tests__/fixtures/relative-app-internal.fixture.ts'),
    ]);
    expect(violations.some((v) => v.rule === 'packs must not import app internal paths')).toBe(
      true,
    );
    expect(violations.some((v) => v.importPath.startsWith('../'))).toBe(true);
  });
});
