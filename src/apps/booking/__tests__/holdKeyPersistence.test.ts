import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { namespacedHoldKey } from '@/apps/booking/application/holdBooking';
import { BOOKING_HOLD_KEY_MAX_LEN } from '../../../../scripts/drvo/migrations/007-booking-hold-key';

/**
 * HoldKey persistence contract without live SQL Server:
 * - DDL + DRVO migration require NVARCHAR(200)
 * - tenant-namespaced keys that exceed the old 80 limit round-trip in an in-memory
 *   store using the exact same key for insert / lookup / release (no truncation).
 */
describe('Booking HoldKey NVARCHAR(200) persistence contract', () => {
  it('new table DDL and DRVO migration use HoldKey NVARCHAR(200)', () => {
    const holdTs = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/bookingHold.ts'),
      'utf8',
    );
    expect(holdTs).toMatch(/HoldKey NVARCHAR\(200\) NOT NULL/);
    expect(holdTs).not.toMatch(/HoldKey NVARCHAR\(80\) NOT NULL/);

    const migrationSql = fs.readFileSync(
      path.join(process.cwd(), 'db/drvo-migrations/007-booking-hold-key/schema.sql'),
      'utf8',
    );
    expect(migrationSql).toContain('NVARCHAR(200)');
    expect(migrationSql).toContain('ALTER COLUMN HoldKey NVARCHAR(200)');
    expect(BOOKING_HOLD_KEY_MAX_LEN).toBe(200);
  });

  it('namespaced key >80 chars persists and releases with exact same key (no truncation)', () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const rawNearOldLimit = 'h'.repeat(70); // historically would fit NVARCHAR(80) alone
    const holdKey = namespacedHoldKey(tenantId, rawNearOldLimit);
    expect(holdKey.startsWith(`t:${tenantId}:`)).toBe(true);
    expect(holdKey.length).toBeGreaterThan(80);
    expect(holdKey.length).toBeLessThanOrEqual(BOOKING_HOLD_KEY_MAX_LEN);

    /** Mirrors TblBookingHold unique HoldKey insert / lookup / release semantics. */
    const table = new Map<string, { holdKey: string; status: 'active' | 'released' }>();

    function insertHold(key: string) {
      if (key.length > BOOKING_HOLD_KEY_MAX_LEN) {
        throw new Error('HOLD_KEY_TRUNCATION_OR_OVERFLOW');
      }
      if (table.has(key)) throw new Error('UQ_TblBookingHold_HoldKey');
      table.set(key, { holdKey: key, status: 'active' });
      return table.get(key)!;
    }

    function lookupActive(key: string) {
      const row = table.get(key);
      if (!row || row.status !== 'active') return null;
      return row;
    }

    function release(key: string) {
      const row = lookupActive(key);
      if (!row) return false;
      // Release must address the exact stored key — truncation would miss.
      expect(row.holdKey).toBe(key);
      row.status = 'released';
      return true;
    }

    const inserted = insertHold(holdKey);
    expect(inserted.holdKey).toBe(holdKey);
    expect(inserted.holdKey.length).toBe(holdKey.length);

    const found = lookupActive(holdKey);
    expect(found?.holdKey).toBe(holdKey);

    // Truncated key (old NVARCHAR(80) behavior) must NOT find the row.
    const truncated = holdKey.slice(0, 80);
    expect(truncated.length).toBe(80);
    expect(lookupActive(truncated)).toBeNull();

    expect(release(holdKey)).toBe(true);
    expect(lookupActive(holdKey)).toBeNull();
    expect(table.get(holdKey)?.status).toBe('released');
  });
});
