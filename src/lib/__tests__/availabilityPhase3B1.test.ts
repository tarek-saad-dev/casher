/**
 * Availability Architecture — Phase 3B.1 tests.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

import {
  WORKFORCE_AVAILABILITY_EXPECTED_ROLES,
  WORKFORCE_AVAILABILITY_PAGE_KEY,
} from '@/lib/permissions/workforceAvailabilityPermissions';
import {
  emitAvailabilityChanged,
  subscribeAvailabilityChanged,
  __resetAvailabilityChangedDebounceForTests,
  AVAILABILITY_CHANGED_EVENT,
} from '@/lib/availability/availabilityChangedEvent';
import {
  getOperationalDate,
  BUSINESS_DAY_CUTOFF_HOUR,
  SALON_TZ,
  shiftCalendarDate,
} from '@/lib/businessDate';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Phase 3B.1 — permissions contracts', () => {
  it('exports expected page key and roles', () => {
    expect(WORKFORCE_AVAILABILITY_PAGE_KEY).toBe('hr.workforce_availability');
    expect(WORKFORCE_AVAILABILITY_EXPECTED_ROLES).toEqual([
      'super_admin',
      'admin',
      'manager',
      'receptionist',
    ]);
  });

  it('seed helpers are idempotent IF NOT EXISTS style', () => {
    const src = read('src/lib/permissions/workforceAvailabilityPermissions.ts');
    expect(src).toContain('IF NOT EXISTS');
    expect(src).toContain('NOT EXISTS (SELECT 1 FROM dbo.TblPageRoleAccess');
    expect(src).not.toContain('DELETE FROM dbo.TblPageRoleAccess');
  });

  it('npm scripts and seed route wire ensure', () => {
    const pkg = read('package.json');
    const seedRoute = read('src/app/api/admin/permissions/seed/route.ts');
    expect(pkg).toContain('seed:permissions');
    expect(pkg).toContain('verify:availability-permissions');
    expect(seedRoute).toContain('ensureWorkforceAvailabilityGrants');
  });

  it('verification detects missing page conceptually', async () => {
    const { verifyWorkforceAvailabilityPermissions } = await import(
      '@/lib/permissions/workforceAvailabilityPermissions'
    );
    const fakeDb = {
      request: () => ({
        input() {
          return this;
        },
        async query(sqlText: string) {
          if (sqlText.includes('TblSystemPages')) return { recordset: [] };
          return { recordset: [] };
        },
      }),
    };
    const result = await verifyWorkforceAvailabilityPermissions(fakeDb as never);
    expect(result.ok).toBe(false);
    expect(result.pageExists).toBe(false);
    expect(result.missingRoleGrants.length).toBe(4);
  });
});

describe('Phase 3B.1 — history API contracts', () => {
  it('list supports status=active|cancelled|all', () => {
    const route = read('src/app/api/admin/availability/daily-adjustments/route.ts');
    const svc = read('src/lib/availability/dailyAdjustmentService.ts');
    expect(route).toContain("statusRaw === 'cancelled'");
    expect(route).toContain('listDailyAdjustmentHistory');
    expect(svc).toContain('listDailyAdjustmentHistory');
    expect(svc).toContain('createdByName');
    expect(svc).toContain('cancelledByName');
    expect(svc).toContain('UserID IN (');
  });

  it('batch loader remains active-only', () => {
    const loader = read('src/lib/availability/loadDailyAdjustmentsBatch.ts');
    expect(loader).toContain('IsActive = 1');
    expect(loader).toContain('CancelledAt IS NULL');
  });

  it('drawer has layers/history tabs and lazy history fetch', () => {
    const drawer = read('src/components/admin/workforce/AvailabilityExplainDrawer.tsx');
    expect(drawer).toContain('الطبقات');
    expect(drawer).toContain('سجل التعديلات');
    expect(drawer).toContain('status=all');
    expect(read('src/components/admin/workforce/DailyAdjustmentHistory.tsx')).toContain('ملغي');
  });
});

describe('Phase 3B.1 — invalidation events', () => {
  beforeEach(() => {
    __resetAvailabilityChangedDebounceForTests();
  });

  it('emits CustomEvent and matching subscribe refreshes', () => {
    const seen: string[] = [];
    const unsub = subscribeAvailabilityChanged((d) => {
      seen.push(d.businessDate);
    });
    emitAvailabilityChanged({ businessDate: '2026-08-03', source: 'create' });
    expect(seen).toContain('2026-08-03');
    // debounce: second immediate emit ignored
    emitAvailabilityChanged({ businessDate: '2026-08-04', source: 'cancel' });
    expect(seen).not.toContain('2026-08-04');
    unsub();
  });

  it('page and ops board subscribe; create/cancel emit', () => {
    const page = read('src/components/admin/workforce/WorkforceAvailabilityPage.tsx');
    const ops = read('src/app/operations/page.tsx');
    expect(page).toContain('emitAvailabilityChanged');
    expect(page).toContain('subscribeAvailabilityChanged');
    expect(ops).toContain('subscribeAvailabilityChanged');
    expect(ops).toContain("reason: 'schedule-applied'");
    expect(AVAILABILITY_CHANGED_EVENT).toBe('availability:changed');
  });
});

describe('Phase 3B.1 — legacy transition', () => {
  it('banner + disabled duplicate actions; attendance kept', () => {
    const modal = read('src/components/operations/ScheduleControlModal.tsx');
    const doc = read('docs/availability-legacy-ui-transition.md');
    expect(modal).toContain('/admin/workforce/availability');
    expect(modal).toContain('movedToWorkforce');
    expect(modal).toContain("t === 'day_off'");
    expect(modal).toContain('restorePresentAndCheckIn');
    expect(doc).toContain('Disable');
    expect(doc).toContain('Keep');
  });

  it('workforce page does not write legacy overrides', () => {
    const page = read('src/components/admin/workforce/WorkforceAvailabilityPage.tsx');
    expect(page).toContain('/api/admin/availability/daily-adjustments');
    expect(page).not.toContain('schedule-control/apply');
    expect(page).not.toContain('booking-control/overrides');
  });
});

describe('Phase 3B.1 — timeline', () => {
  it('read-only timeline with legend and multi-window note', () => {
    const tl = read('src/components/admin/workforce/AvailabilityDayTimeline.tsx');
    expect(tl).toContain('AvailabilityDayTimeline');
    expect(tl).toContain(
      'جميع فترات العمل المعروضة تُستخدم فعليًا في الحجز والطابور وإعادة الجدولة',
    );
    expect(tl).toContain('role="img"');
    expect(tl).toContain('مفتاح الألوان');
    expect(tl).not.toContain('onDrag');
    expect(tl).not.toContain('onMouseDown');
  });
});

describe('Phase 3B.1 — operational date', () => {
  it('Cairo 03:59 vs 04:00 cutoff', () => {
    // Construct instants that are 03:59 and 04:00 in Africa/Cairo on a fixed calendar day.
    // Use UTC offsets carefully: Cairo is typically UTC+2 or +3 depending on DST.
    const atHour = (hour: number, minute: number) => {
      // Probe: find a Date whose Cairo hour matches
      for (let utcH = 0; utcH < 24; utcH++) {
        const d = new Date(Date.UTC(2026, 7, 3, utcH, minute, 0));
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: SALON_TZ,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(d);
        const h = Number(parts.find((p) => p.type === 'hour')?.value);
        const m = Number(parts.find((p) => p.type === 'minute')?.value);
        if (h === hour && m === minute) return d;
      }
      throw new Error(`Could not find UTC instant for Cairo ${hour}:${minute}`);
    };

    expect(BUSINESS_DAY_CUTOFF_HOUR).toBe(4);
    const before = atHour(3, 59);
    const after = atHour(4, 0);
    const beforeBiz = getOperationalDate({ now: before });
    const afterBiz = getOperationalDate({ now: after });
    const calBefore = before.toLocaleDateString('en-CA', { timeZone: SALON_TZ });
    const calAfter = after.toLocaleDateString('en-CA', { timeZone: SALON_TZ });
    expect(beforeBiz).toBe(shiftCalendarDate(calBefore, -1));
    expect(afterBiz).toBe(calAfter);
  });

  it('page preserves selectedDate after mutation refresh', () => {
    const page = read('src/components/admin/workforce/WorkforceAvailabilityPage.tsx');
    expect(page).toContain('await loadDay(selectedDate)');
    expect(page).not.toContain('toISOString().slice(0, 10)');
  });
});

describe('Phase 3B.1 — accessibility', () => {
  it('confirm dialog and live regions exist', () => {
    const confirm = read('src/components/admin/workforce/WorkforceConfirmDialog.tsx');
    const page = read('src/components/admin/workforce/WorkforceAvailabilityPage.tsx');
    const history = read('src/components/admin/workforce/DailyAdjustmentHistory.tsx');
    expect(confirm).toContain('aria-describedby');
    expect(confirm).toContain('DialogTitle');
    expect(page).toContain('aria-live="polite"');
    expect(history).toContain('aria-describedby');
  });
});
