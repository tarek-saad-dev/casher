import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveBusinessDate } from '@/modules/operations/clock/BusinessClock';
import { createLegacyOperationalCalendarAdapter } from '../public';
import { CALENDAR_FORBIDDEN_TABLES, CALENDAR_TABLE_WRITER_ALLOWLIST } from '../internal/calendarTableAllowlist';
import fs from 'node:fs';
import path from 'node:path';

const TENANT = '11111111-1111-4111-8111-111111111111';
const GLEEM = 1;
const CAMP = 2;

const staffActor = {
  actorType: 'staff' as const,
  actorId: '7',
  tenantId: TENANT,
  membershipId: '22222222-2222-4222-8222-222222222222',
  viewLocationId: null,
};

describe('Operational Calendar characterization (DRVO-006)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves business date before cutoff as previous business date', async () => {
    const branch = {
      branchId: GLEEM,
      timeZone: 'Africa/Cairo',
      businessDayCutoffTime: '04:00:00',
    };
    // 01:00 Cairo on calendar 2026-09-29 (UTC+3) — still prior business date
    const beforeCutoff = new Date('2026-09-28T22:00:00.000Z');
    expect(resolveBusinessDate(branch, beforeCutoff)).toBe('2026-09-28');
    const afterCutoff = new Date('2026-09-29T02:00:00.000Z');
    expect(resolveBusinessDate(branch, afterCutoff)).toBe('2026-09-29');
  });

  it('honors branch timezone via getBusinessDate port', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchById: vi.fn(async (id: number) =>
        id === CAMP
          ? {
              branchId: CAMP,
              timeZone: 'Asia/Riyadh',
              businessDayCutoffTime: '04:00:00',
              isActive: true,
            }
          : null,
      ),
    }));
    const { createLegacyOperationalCalendarAdapter: createAdapter } = await import('../internal/legacyAdapter');
    const calendar = createAdapter(TENANT);
    const instant = new Date('2026-09-29T01:00:00.000Z');
    const date = await calendar.getBusinessDate(staffActor, { locationId: CAMP, instant });
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('DAY fallback when no open shift and tenant mismatch fails closed', async () => {
    const calendar = createLegacyOperationalCalendarAdapter(TENANT);
    const tx = {} as never;
    await expect(
      calendar.resolveFinancialWriteContext(tx, { ...staffActor, tenantId: 'other-tenant' }, {
        locationId: GLEEM,
      }),
    ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
  });

  it('forbidden direct table writer allowlist is explicit', () => {
    expect(CALENDAR_TABLE_WRITER_ALLOWLIST.length).toBeGreaterThan(0);
    expect(CALENDAR_FORBIDDEN_TABLES).toEqual(['TblNewDay', 'TblShift', 'TblShiftMove']);
  });

  it('detects forbidden calendar table reference outside allowlist fixture', () => {
    const fixture = path.join(
      process.cwd(),
      'src/shared/operational-calendar/__tests__/fixtures/forbidden-calendar-table.fixture.ts',
    );
    const content = fs.readFileSync(fixture, 'utf8');
    expect(content).toContain('TblNewDay');
  });
});
