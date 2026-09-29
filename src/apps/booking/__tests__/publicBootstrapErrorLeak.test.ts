import { describe, expect, it } from 'vitest';
import {
  describePlatformBootstrapFailure,
  isPlatformBootstrapFailure,
  PUBLIC_PLATFORM_BOOTSTRAP_MESSAGE,
} from '@/lib/booking/platformBootstrapErrors';
import { publicBookingErrorBody } from '@/lib/booking/publicBookingErrorCatalog';
import fs from 'node:fs';
import path from 'node:path';

describe('public PLATFORM_BOOTSTRAP_REQUIRED must not leak DB errors', () => {
  const sqlLeak = "Invalid object name 'dbo.Tenant'.";

  it('detects bootstrap failures for logging', () => {
    expect(isPlatformBootstrapFailure(new Error(sqlLeak))).toBe(true);
    expect(describePlatformBootstrapFailure(new Error(sqlLeak))).toBe(sqlLeak);
  });

  it('catalog body has no cause / SQL / table names', () => {
    const body = publicBookingErrorBody('PLATFORM_BOOTSTRAP_REQUIRED');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('dbo.Tenant');
    expect(serialized).not.toContain('Invalid object name');
    expect(serialized).not.toContain('cause');
    expect(body.error.technicalMessage).toBe(PUBLIC_PLATFORM_BOOTSTRAP_MESSAGE);
    expect(body.error.metadata).toEqual({});
  });

  it('passing a cause metadata must not be used by routes (routes omit metadata)', () => {
    // Guard: even if someone passes cause into the catalog helper, tests document the leak shape.
    const leaked = publicBookingErrorBody('PLATFORM_BOOTSTRAP_REQUIRED', {
      cause: sqlLeak,
    });
    expect(JSON.stringify(leaked)).toContain(sqlLeak);

    for (const rel of [
      'src/app/api/public/booking/create/route.ts',
      'src/app/api/public/booking/cancel/route.ts',
      'src/app/api/public/booking/[code]/cancel/route.ts',
      'src/app/api/public/booking/hold/route.ts',
    ]) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(src).toContain('isPlatformBootstrapFailure');
      expect(src).not.toMatch(/cause:\s*describePlatformBootstrapFailure/);
    }
  });
});
