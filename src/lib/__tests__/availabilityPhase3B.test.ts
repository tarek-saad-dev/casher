/**
 * Availability Architecture — Phase 3B: Workforce Availability UI tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

import {
  inferWorkforceUiStatus,
  WORKFORCE_UI_STATUS_AR,
  formatHhmmPreview,
  EXPLAIN_TIMELINE_STEP_AR,
} from '@/lib/availability/workforceUiLabels';
import {
  validateWindowDrafts,
  inferEndDayOffset,
  normalizeWindowDraft,
  isZeroDurationWindow,
} from '@/lib/availability/timeWindowEditorUtils';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Phase 3B — routes and page contracts', () => {
  it('page route and layout exist with PageGuard', () => {
    const page = read('src/app/admin/workforce/availability/page.tsx');
    const layout = read('src/app/admin/workforce/availability/layout.tsx');
    expect(page).toContain('WorkforceAvailabilityPage');
    expect(layout).toContain('PageGuard');
    expect(layout).toContain('/admin/workforce/availability');
  });

  it('uses canonical operational date — not UTC ISO slice for business date', () => {
    const page = read('src/components/admin/workforce/WorkforceAvailabilityPage.tsx');
    const header = read('src/components/admin/workforce/WorkforceAvailabilityHeader.tsx');
    expect(page).toContain('getOperationalDate');
    expect(page).not.toContain("toISOString().slice(0, 10)");
    expect(header).toContain('shiftCalendarDate');
    expect(page).toContain('/api/admin/availability/workforce-day');
    expect(page).toContain('/api/admin/availability/daily-adjustments');
    expect(page).toContain('method: \'DELETE\'');
    expect(page).not.toMatch(/body\.branchId|JSON\.stringify\(\{[^}]*branchId/);
    expect(page).toContain('empId: selectedEmployee.employeeId');
  });

  it('nav and permissions seed include workforce availability', () => {
    const nav = read('src/components/layout/nav-config.ts');
    const seed = read('src/app/api/admin/permissions/seed/route.ts');
    expect(nav).toContain('/admin/workforce/availability');
    expect(nav).toContain('توافر الموظفين');
    expect(seed).toContain('hr.workforce_availability');
    expect(seed).toContain('/admin/workforce/availability');
  });

  it('legacy schedule UI points to new page', () => {
    const modal = read('src/components/operations/ScheduleControlModal.tsx');
    const drawer = read('src/components/operations/BookingControlDrawer.tsx');
    expect(modal).toContain('لإدارة تعديلات التوافر اليومية');
    expect(modal).toContain('/admin/workforce/availability');
    expect(drawer).toContain('/admin/workforce/availability');
  });
});

describe('Phase 3B — workforce-day API contracts', () => {
  it('requires auth and session branch; uses batch plan + explainEmployeeDayPlan', () => {
    const route = read('src/app/api/admin/availability/workforce-day/route.ts');
    const svc = read('src/lib/availability/workforceDay.ts');
    expect(route).toContain('requirePageAccess');
    expect(route).toContain('requireBranchOperationAccess');
    expect(route).toContain('branch.branchId');
    expect(route).not.toMatch(/searchParams\.get\(['\"]branch/);
    expect(svc).toContain('resolveEmployeeDayPlansBatch');
    expect(svc).toContain('explainEmployeeDayPlan');
    expect(svc).not.toContain('resolveEmployeeDayPlan(');
    expect(svc).toContain('dailyAdjustments');
    expect(svc).not.toMatch(/ClientName|Phone|customer/i);
  });

  it('mutations invalidate schedule caches', () => {
    const svc = read('src/lib/availability/dailyAdjustmentService.ts');
    expect(svc).toContain('invalidateEmployeeScheduleCaches');
  });
});

describe('Phase 3B — UI status inference', () => {
  it('maps canonical day-plan fields to Arabic badges', () => {
    expect(inferWorkforceUiStatus({ isWorking: true, denyReasonCode: null }).labelAr).toBe(
      WORKFORCE_UI_STATUS_AR.available,
    );
    expect(
      inferWorkforceUiStatus({
        isWorking: true,
        denyReasonCode: null,
        blockedIntervals: [{ startMs: 1, endMs: 2 }],
      }).key,
    ).toBe('partially_available');
    expect(
      inferWorkforceUiStatus({ isWorking: false, denyReasonCode: 'EMPLOYEE_ABSENT' }).labelAr,
    ).toBe('غائب');
    expect(
      inferWorkforceUiStatus({
        isWorking: false,
        denyReasonCode: 'DAY_CLOSED_BY_ADJUSTMENT',
      }).labelAr,
    ).toBe('اليوم مغلق');
    expect(
      inferWorkforceUiStatus({
        isWorking: false,
        denyReasonCode: 'SCHEDULE_NOT_CONFIGURED',
      }).labelAr,
    ).toBe('بدون جدول');
    expect(
      inferWorkforceUiStatus({ isWorking: false, denyReasonCode: 'EMPLOYEE_OFF_DAY' }).labelAr,
    ).toBe('إجازة');
  });

  it('formats overnight preview and timeline labels', () => {
    expect(formatHhmmPreview('22:00', '02:00', 1)).toContain('اليوم التالي');
    expect(EXPLAIN_TIMELINE_STEP_AR.DAILY_CLOSE_APPLIED).toBeTruthy();
  });
});

describe('Phase 3B — modal / window validation', () => {
  it('CLOSE_DAY forbids windows; others require them', () => {
    expect(
      validateWindowDrafts([{ start: '10:00', end: '12:00', endDayOffset: 0 }], {
        required: false,
        forbidden: true,
      }).ok,
    ).toBe(false);
    expect(
      validateWindowDrafts([], { required: true, forbidden: false }).ok,
    ).toBe(false);
    expect(
      validateWindowDrafts([{ start: '10:00', end: '12:00', endDayOffset: 0 }], {
        required: true,
        forbidden: false,
      }).ok,
    ).toBe(true);
  });

  it('overnight produces endDayOffset 1 and rejects zero duration', () => {
    expect(inferEndDayOffset('22:00', '02:00')).toBe(1);
    expect(normalizeWindowDraft({ start: '22:00', end: '02:00' })?.endDayOffset).toBe(1);
    expect(isZeroDurationWindow({ start: '10:00', end: '10:00', endDayOffset: 0 })).toBe(true);
    expect(normalizeWindowDraft({ start: '10:00', end: '10:00', endDayOffset: 0 })).toBeNull();
  });

  it('detects duplicates and overlap warning', () => {
    const dup = validateWindowDrafts(
      [
        { start: '10:00', end: '12:00', endDayOffset: 0 },
        { start: '10:00', end: '12:00', endDayOffset: 0 },
      ],
      { required: true, forbidden: false },
    );
    expect(dup.ok).toBe(false);

    const overlap = validateWindowDrafts(
      [
        { start: '10:00', end: '14:00', endDayOffset: 0 },
        { start: '12:00', end: '16:00', endDayOffset: 0 },
      ],
      { required: true, forbidden: false },
    );
    expect(overlap.ok).toBe(true);
    if (overlap.ok) expect(overlap.overlapWarning).toBe(true);
  });

  it('modal prevents duplicate submit while saving and shows Arabic errors', () => {
    const modal = read('src/components/admin/workforce/DailyAdjustmentModal.tsx');
    expect(modal).toContain('if (saving) return');
    expect(modal).toContain('role="alert"');
    expect(modal).toContain('disabled={saving}');
    expect(modal).toContain('سيتم إغلاق يوم الموظف بالكامل');
  });

  it('page preserves selected date and refreshes after mutations', () => {
    const page = read('src/components/admin/workforce/WorkforceAvailabilityPage.tsx');
    expect(page).toContain('await loadDay(selectedDate)');
    expect(page).toContain('setSelectedDate');
    expect(page).toContain('AbortController');
  });
});

describe('Phase 3B — rendering contracts', () => {
  it('cards and drawers show windows, blocks, status, layers inspector', () => {
    const card = read('src/components/admin/workforce/EmployeeAvailabilityCard.tsx');
    const drawer = read('src/components/admin/workforce/AvailabilityExplainDrawer.tsx');
    const history = read('src/components/admin/workforce/DailyAdjustmentHistory.tsx');
    const grid = read('src/components/admin/workforce/EmployeeAvailabilityGrid.tsx');
    const inspector = read(
      'src/components/admin/workforce/layers/AvailabilityLayersInspector.tsx',
    );
    expect(card).toContain('AvailabilityTimeChips');
    expect(card).toContain('blockedIntervals');
    expect(card).toContain('dailyAdjustmentState');
    expect(card).toContain('إغلاق اليوم');
    expect(drawer).toContain('AvailabilityLayersInspector');
    expect(drawer).toContain('طبقات توافر الموظف');
    expect(inspector).toContain('طبقات توافر الموظف');
    expect(drawer).toContain('DailyAdjustmentHistory');
    expect(history).toContain('إلغاء تعديل');
    expect(grid).toContain('لا يوجد موظفون');
  });

  it('page shows loading skeletons, error retry, toast live region', () => {
    const page = read('src/components/admin/workforce/WorkforceAvailabilityPage.tsx');
    expect(page).toContain('animate-pulse');
    expect(page).toContain('إعادة المحاولة');
    expect(page).toContain('aria-live="polite"');
  });
});
