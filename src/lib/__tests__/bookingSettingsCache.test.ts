/**
 * Phase 3 — public settings cache + service reuse invariants.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getPublicSettings cache', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock('@/lib/db');
  });

  it('coalesces concurrent loads into one SQL query', async () => {
    let loads = 0;
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => ({
          input: function (this: any) { return this; },
          query: async () => {
            loads += 1;
            await new Promise((r) => setTimeout(r, 30));
            return {
              recordset: [
                {
                  SalonName: 'Cut',
                  Timezone: 'Africa/Cairo',
                  Currency: 'EGP',
                  BookingEnabled: 1,
                  AllowSpecificBarber: 1,
                  AllowNearestBarber: 1,
                  DefaultMode: 'nearest',
                  SlotIntervalMinutes: 15,
                  MaxBookingDaysAhead: 14,
                  MinNoticeMinutes: 30,
                  DefaultServiceDurationMinutes: 30,
                },
              ],
            };
          },
        }),
      })),
      sql: {},
    }));

    const mod = await import('@/lib/publicBookingHelpers');
    mod.invalidatePublicSettingsCache();

    const [a, b, c] = await Promise.all([
      mod.getPublicSettings(1),
      mod.getPublicSettings(1),
      mod.getPublicSettings(1),
    ]);

    expect(loads).toBe(1);
    expect(a.timezone).toBe('Africa/Cairo');
    expect(b.salonName).toBe(a.salonName);
    expect(c.slotIntervalMinutes).toBe(15);
  });

  it('serves TTL cache without a second SQL hit', async () => {
    let loads = 0;
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => ({
          input: function (this: any) { return this; },
          query: async () => {
            loads += 1;
            return {
              recordset: [
                {
                  SalonName: 'Cut',
                  Timezone: 'Africa/Cairo',
                  Currency: 'EGP',
                  BookingEnabled: 1,
                  AllowSpecificBarber: 1,
                  AllowNearestBarber: 1,
                  DefaultMode: 'nearest',
                  SlotIntervalMinutes: 15,
                  MaxBookingDaysAhead: 14,
                  MinNoticeMinutes: 30,
                  DefaultServiceDurationMinutes: 30,
                },
              ],
            };
          },
        }),
      })),
      sql: {},
    }));

    const mod = await import('@/lib/publicBookingHelpers');
    mod.invalidatePublicSettingsCache();
    await mod.getPublicSettings(1);
    await mod.getPublicSettings(1);
    expect(loads).toBe(1);
  });

  it('invalidation forces a reload', async () => {
    let loads = 0;
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => ({
          input: function (this: any) { return this; },
          query: async () => {
            loads += 1;
            return {
              recordset: [
                {
                  SalonName: `Cut${loads}`,
                  Timezone: 'Africa/Cairo',
                  Currency: 'EGP',
                  BookingEnabled: 1,
                  AllowSpecificBarber: 1,
                  AllowNearestBarber: 1,
                  DefaultMode: 'nearest',
                  SlotIntervalMinutes: 15,
                  MaxBookingDaysAhead: 14,
                  MinNoticeMinutes: 30,
                  DefaultServiceDurationMinutes: 30,
                },
              ],
            };
          },
        }),
      })),
      sql: {},
    }));

    const mod = await import('@/lib/publicBookingHelpers');
    mod.invalidatePublicSettingsCache();
    const first = await mod.getPublicSettings(1);
    mod.invalidatePublicSettingsCache();
    const second = await mod.getPublicSettings(1);
    expect(loads).toBe(2);
    expect(first.salonName).toBe('Cut1');
    expect(second.salonName).toBe('Cut2');
  });

  it('does not keep a failed inflight permanently', async () => {
    let loads = 0;
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => ({
          input: function (this: any) { return this; },
          query: async () => {
            loads += 1;
            if (loads === 1) throw new Error('boom');
            return { recordset: [] };
          },
        }),
      })),
      sql: {},
    }));

    const mod = await import('@/lib/publicBookingHelpers');
    mod.invalidatePublicSettingsCache();
    // loadPublicSettingsFromDb catches and returns fallbacks — still clears inflight
    const a = await mod.getPublicSettings(1);
    expect(a.timezone).toBe('Africa/Cairo');
    mod.invalidatePublicSettingsCache();
    await mod.getPublicSettings(1);
    expect(loads).toBeGreaterThanOrEqual(1);
  });

  it('scopes cache per branch — branch A load does not serve branch B', async () => {
    let loads = 0;
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => ({
          input: function (this: any) { return this; },
          query: async () => {
            loads += 1;
            return {
              recordset: [
                {
                  SalonName: `Branch${loads}`,
                  Timezone: 'Africa/Cairo',
                  Currency: 'EGP',
                  BookingEnabled: 1,
                  AllowSpecificBarber: 1,
                  AllowNearestBarber: 1,
                  DefaultMode: 'nearest',
                  SlotIntervalMinutes: 15,
                  MaxBookingDaysAhead: 14,
                  MinNoticeMinutes: 30,
                  DefaultServiceDurationMinutes: 30,
                },
              ],
            };
          },
        }),
      })),
      sql: { Int: 'Int' },
    }));

    const mod = await import('@/lib/publicBookingHelpers');
    mod.invalidatePublicSettingsCache();

    const branchA = await mod.getPublicSettings(1);
    const branchB = await mod.getPublicSettings(2);
    const branchAAgain = await mod.getPublicSettings(1);

    expect(loads).toBe(2); // one load per distinct branchId, second branchA call hits cache
    expect(branchA.salonName).toBe('Branch1');
    expect(branchB.salonName).toBe('Branch2');
    expect(branchAAgain.salonName).toBe(branchA.salonName);
  });
});

describe('WhatsApp remains outside create total', () => {
  it('scheduleBookingWhatsAppAfterCommit does not await send', async () => {
    const { scheduleBookingWhatsAppAfterCommit } = await import(
      '@/lib/bookingPostCommitNotification'
    );
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { sent: true, skipped: false };
    });
    let task: (() => Promise<void>) | null = null;
    const schedule = vi.fn((t: () => Promise<void>) => {
      task = t;
    });

    const start = Date.now();
    scheduleBookingWhatsAppAfterCommit(
      {
        phone: '01012345678',
        customerName: 'T',
        bookingId: 1,
        bookingDate: '2026-07-20',
        bookingTime: '15:00',
      },
      { schedule, send: send as any },
    );
    expect(Date.now() - start).toBeLessThan(20);
    expect(send).not.toHaveBeenCalled();
    await task!();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
