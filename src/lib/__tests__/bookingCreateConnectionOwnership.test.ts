/**
 * Phase 6B — connection ownership / persistence contract tests.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('bookingCreateConnectionOwnership', () => {
  it('serializes busy queries under Transaction and failHard', () => {
    const src = read('src/lib/scheduleIntegrity.ts');
    expect(src).toContain('const onTx = !!args.transaction');
    expect(src).toContain('failHard: true');
    expect(src).toMatch(/if \(onTx\) \{[\s\S]*buildQueueIntervals[\s\S]*buildBookingIntervals/);
  });

  it('overrides loader is sequential (no Promise.all on TX)', () => {
    const src = read('src/lib/hr/attendance-shift-schedule-sync.ts');
    const fn = src.slice(src.indexOf('export async function loadBookingOverridesForDate'));
    const body = fn.slice(0, fn.indexOf('export async function loadBookingOverridesForBarber'));
    expect(body).not.toContain('Promise.all');
    expect(body).toContain('await loadOverridesForDate');
    expect(body).toContain('await loadAttendanceExpandOverrides');
  });
});

describe('bookingCreatePoolSafety', () => {
  it('documents pool max=10 and does not blindly raise it in create', () => {
    const db = read('src/lib/db.ts');
    expect(db).toMatch(/max:\s*10/);
    const create = read('src/lib/booking/publicBookingCreate.ts');
    expect(create).not.toContain('pool.max');
  });
});

describe('bookingCreatePersistenceContract', () => {
  it('persists PublicWorkDate / DayOffset / Absolute* / IdempotencyRequestID', () => {
    const create = read('src/lib/booking/publicBookingCreate.ts');
    expect(create).toContain('PublicWorkDate');
    expect(create).toContain('PublicDayOffset');
    expect(create).toContain('AbsoluteStartUtc');
    expect(create).toContain('AbsoluteEndUtc');
    expect(create).toContain('IdempotencyRequestID');
    expect(create).toContain('ensureBookingPublicWorkDateColumns');
  });
});

describe('bookingCreateLiveConcurrency', () => {
  it('verifier fails on pool-acquisition-only outcomes', () => {
    const v = read('scripts/verify-booking-create-concurrency.ts');
    expect(v).toContain('POOL_ACQUISITION_FAILURE');
    expect(v).toContain('makeBarrier');
    expect(v).toContain('Expected exactly 1 success');
  });
});
