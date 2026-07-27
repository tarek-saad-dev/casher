/** Booking Phase 7C2 — upcoming reader batches service lines. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingUpcomingBatchServices', () => {
  const readerPath = path.join(
    process.cwd(),
    'src/lib/booking/publicBookingReader.ts',
  );

  it('listPublicUpcomingBookings uses loadServiceLinesBatch (not per-row load)', () => {
    const src = fs.readFileSync(readerPath, 'utf8');
    expect(src).toContain('async function loadServiceLinesBatch');
    expect(src).toContain('const serviceMap = await loadServiceLinesBatch');
    expect(src).toContain('listPublicUpcomingBookings');
    const upcomingSection = src.slice(src.indexOf('export async function listPublicUpcomingBookings'));
    expect(upcomingSection).toContain('loadServiceLinesBatch');
    expect(upcomingSection).not.toMatch(/for\s*\([^)]+\)\s*\{[^}]*loadServiceLines\(/s);
  });

  it('single-booking path delegates to batch helper', () => {
    const src = fs.readFileSync(readerPath, 'utf8');
    expect(src).toMatch(/loadServiceLines\([\s\S]*loadServiceLinesBatch/);
  });
});
