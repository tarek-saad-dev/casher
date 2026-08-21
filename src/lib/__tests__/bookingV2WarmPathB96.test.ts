/**
 * Booking V2 B9.6 — warm path optimization contracts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadAvailabilityRevisionBatchSoft,
  __resetWarmMatrixContextForTests,
  bumpWarmMatrixContextRevision,
  getWarmMatrixContextRevision,
} from '@/lib/booking/cache/WarmMatrixContextCache';
import { normalizeSqlBusinessDate } from '@/lib/booking/cache/AvailabilityRevisionSqlStore';

const root = process.cwd();

describe('B9.6 warm matrix optimizations', () => {
  it('matrix uses warm context cache and freeMaskB64 (no re-encode path)', () => {
    const src = readFileSync(
      join(root, 'src/lib/booking/v2Frontend/buildAvailabilityMatrix.ts'),
      'utf8',
    );
    expect(src).toContain('getOrLoadWarmMatrixContext');
    expect(src).toContain('freeMaskB64');
    expect(src).toContain('WarmMatrixLatencyBreakdown');
    // Avoid reconstructing bitmap from ranges on the happy path
    expect(src).toContain('d.freeMaskB64');
  });

  it('compose emits freeMaskB64 from hot payload', () => {
    const src = readFileSync(
      join(root, 'src/lib/booking/cache/composeV2DayFromHotPayload.ts'),
      'utf8',
    );
    expect(src).toContain('freeMaskB64: args.payload.freeMask.toBase64()');
  });

  it('live resolver uses soft revision memo (SQL remains source)', () => {
    const src = readFileSync(
      join(root, 'src/lib/booking/projection/resolveBookingAvailabilityV2Live.ts'),
      'utf8',
    );
    expect(src).toContain('loadAvailabilityRevisionBatchSoft');
  });

  it('warm context bump increments revision', () => {
    __resetWarmMatrixContextForTests();
    const a = getWarmMatrixContextRevision();
    bumpWarmMatrixContextRevision('test');
    expect(getWarmMatrixContextRevision()).toBe(a + 1);
  });

  it('revision soft memo returns softHit without SQL on second call', async () => {
    __resetWarmMatrixContextForTests();
    // Without DB table, first call may return empty with queryCount 0/1.
    // Second call within soft TTL must softHit.
    const first = await loadAvailabilityRevisionBatchSoft({
      employeeIds: [12],
      fromBusinessDate: '2026-08-16',
      toBusinessDate: '2026-08-29',
    });
    const second = await loadAvailabilityRevisionBatchSoft({
      employeeIds: [12],
      fromBusinessDate: '2026-08-16',
      toBusinessDate: '2026-08-29',
    });
    expect(second.softHit).toBe(true);
    expect(second.queryCount).toBe(0);
    expect(second.byKey).toBe(first.byKey);
  });

  it('invalidation clears soft memo on occupancy bump wiring', () => {
    const inv = readFileSync(
      join(root, 'src/lib/booking/cache/HotAvailabilityInvalidation.ts'),
      'utf8',
    );
    expect(inv).toContain('clearAvailabilityRevisionSoftMemo');
    expect(inv).not.toContain("void import('@/lib/booking/cache/WarmMatrixContextCache')");
  });

  it('normalizes SQL Date objects to YYYY-MM-DD for revision keys', () => {
    expect(
      normalizeSqlBusinessDate(new Date('2026-08-18T00:00:00.000Z')),
    ).toBe('2026-08-18');
    expect(normalizeSqlBusinessDate('2026-08-18T00:00:00.000Z')).toBe('2026-08-18');
  });
});
