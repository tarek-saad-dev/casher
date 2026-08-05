/**
 * Availability Architecture — Phase 3A: Daily Adjustment Model tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

import {
  DAILY_ADJUSTMENT_SOURCES,
  DAILY_ADJUSTMENT_TYPES,
  inferDailyAdjustmentState,
  materializeAdjustmentWindow,
  validateCreateDailyAdjustmentInput,
  type EmployeeDailyAdjustment,
} from '@/lib/availability/dailyAdjustments';
import {
  applyDailyAdjustments,
  isFullyBlockedByIntervals,
  mergeWorkingWindows,
} from '@/lib/availability/applyDailyAdjustments';
import { buildEmployeeDayPlanFromInputs } from '@/lib/availability/resolveEmployeeDayPlan';
import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import { explainEmployeeDayPlan } from '@/lib/availability/explainAvailability';
import {
  AVAILABILITY_REASON_CODES,
  mapLegacySlotReason,
} from '@/lib/availability/reasonCodes';
import { evaluateBookingSlotAt } from '@/lib/bookingAvailabilityEngine';
import { salonDateTimeToMs } from '@/lib/publicBookingHelpers';
import { SALON_TZ } from '@/lib/businessDate';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const DATE = '2026-08-03';
const TZ = SALON_TZ;

function win(start: string, end: string, endDayOffset: 0 | 1 = 0) {
  const mat = materializeAdjustmentWindow(DATE, { start, end, endDayOffset }, TZ);
  if (!mat) throw new Error(`bad window ${start}-${end}`);
  return {
    start: mat.start,
    end: mat.end,
    endDayOffset: mat.endDayOffset,
    startMs: mat.startMs,
    endMs: mat.endMs,
  };
}

function adj(
  partial: Partial<EmployeeDailyAdjustment> &
    Pick<EmployeeDailyAdjustment, 'adjustmentId' | 'adjustmentType'>,
): EmployeeDailyAdjustment {
  return {
    branchId: 1,
    employeeId: 10,
    businessDate: DATE,
    reasonCode: null,
    reasonText: null,
    source: 'admin',
    windows: [],
    createdBy: 1,
    createdAt: `2026-08-03T10:00:0${partial.adjustmentId % 10}Z`,
    version: 1,
    ...partial,
  };
}

function baseInputs(
  overrides: Partial<EmployeeDayPlanBatchInputs> = {},
): EmployeeDayPlanBatchInputs {
  return {
    windowsMap: new Map([
      [10, { isWorkingDay: true, startTime: '11:00', endTime: '17:00', source: 'BRANCH_WEEKLY' }],
    ]),
    overridesMap: new Map(),
    freelanceUnlocks: new Map(),
    attendanceMap: new Map(),
    dayOffEmpIds: new Set(),
    absentEmpIds: new Set(),
    timezone: TZ,
    dailyAdjustmentsMap: new Map(),
    ...overrides,
  };
}

describe('Phase 3A — schema and contracts', () => {
  it('migration defines tables, types, overnight offset, soft cancel columns', () => {
    const sql = read('db/migrations/create-emp-daily-adjustment.sql');
    expect(sql).toContain('TblEmpDailyAdjustment');
    expect(sql).toContain('TblEmpDailyAdjustmentWindow');
    expect(sql).toContain("CLOSE_DAY");
    expect(sql).toContain("REPLACE_WINDOWS");
    expect(sql).toContain("ADD_WINDOW");
    expect(sql).toContain("BLOCK_WINDOW");
    expect(sql).toContain('EndDayOffset');
    expect(sql).toContain('CancelledAt');
    expect(sql).toContain('IsActive');
    expect(sql).toContain('IX_TblEmpDailyAdjustment_Branch_Emp_Date_Active');
  });

  it('ensure helper stays off SERIALIZABLE booking TX', () => {
    const ensure = read('src/lib/availability/ensureDailyAdjustmentTables.ts');
    const loader = read('src/lib/availability/loadDailyAdjustmentsBatch.ts');
    expect(ensure).toContain('Do not call from SERIALIZABLE');
    expect(loader).toContain('DDL ensure never on TX');
  });

  it('exports adjustment and source types', () => {
    expect([...DAILY_ADJUSTMENT_TYPES]).toEqual([
      'CLOSE_DAY',
      'REPLACE_WINDOWS',
      'ADD_WINDOW',
      'BLOCK_WINDOW',
    ]);
    expect(DAILY_ADJUSTMENT_SOURCES).toContain('admin');
    expect(DAILY_ADJUSTMENT_SOURCES).toContain('migration');
  });

  it('API never trusts client branchId', () => {
    const route = read('src/app/api/admin/availability/daily-adjustments/route.ts');
    const cancel = read(
      'src/app/api/admin/availability/daily-adjustments/[adjustmentId]/route.ts',
    );
    expect(route).toContain('Never trust client branchId');
    expect(route).toContain('branch.branchId');
    expect(route).not.toMatch(/body\.branchId/);
    expect(cancel).toContain('branch.branchId');
    expect(cancel).toContain('cancelDailyAdjustment');
  });

  it('reason codes include Phase 3A additions', () => {
    for (const code of [
      'BLOCKED_BY_DAILY_ADJUSTMENT',
      'DAY_CLOSED_BY_ADJUSTMENT',
      'NO_USABLE_WINDOW_AFTER_ADJUSTMENTS',
    ]) {
      expect(AVAILABILITY_REASON_CODES).toContain(code);
    }
    expect(mapLegacySlotReason('daily_adjustment')).toBe('BLOCKED_BY_DAILY_ADJUSTMENT');
  });
});

describe('Phase 3A — validation', () => {
  it('CLOSE_DAY forbids windows; others require windows', () => {
    expect(
      validateCreateDailyAdjustmentInput({
        branchId: 1,
        empId: 10,
        businessDate: DATE,
        adjustmentType: 'CLOSE_DAY',
        createdBy: 1,
        windows: [{ start: '10:00', end: '11:00' }],
      }).ok,
    ).toBe(false);

    expect(
      validateCreateDailyAdjustmentInput({
        branchId: 1,
        empId: 10,
        businessDate: DATE,
        adjustmentType: 'ADD_WINDOW',
        createdBy: 1,
        windows: [],
      }).ok,
    ).toBe(false);

    expect(
      validateCreateDailyAdjustmentInput({
        branchId: 1,
        empId: 10,
        businessDate: DATE,
        adjustmentType: 'CLOSE_DAY',
        createdBy: 1,
      }).ok,
    ).toBe(true);
  });

  it('rejects zero-duration and invalid endDayOffset', () => {
    const zero = validateCreateDailyAdjustmentInput({
      branchId: 1,
      empId: 10,
      businessDate: DATE,
      adjustmentType: 'REPLACE_WINDOWS',
      createdBy: 1,
      windows: [{ start: '10:00', end: '10:00', endDayOffset: 0 }],
    });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.code).toBe('INVALID_WINDOW');

    const badOffset = validateCreateDailyAdjustmentInput({
      branchId: 1,
      empId: 10,
      businessDate: DATE,
      adjustmentType: 'ADD_WINDOW',
      createdBy: 1,
      windows: [{ start: '10:00', end: '11:00', endDayOffset: 2 as 0 | 1 }],
    });
    expect(badOffset.ok).toBe(false);
  });

  it('materializes overnight windows with endDayOffset', () => {
    const overnight = materializeAdjustmentWindow(DATE, {
      start: '22:00',
      end: '02:00',
      endDayOffset: 1,
    });
    expect(overnight?.endDayOffset).toBe(1);
    expect(overnight!.endMs).toBeGreaterThan(overnight!.startMs);
  });
});

describe('Phase 3A — application engine', () => {
  const base = [win('11:00', '17:00')];

  it('CLOSE_DAY clears windows', () => {
    const r = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: base,
      baseBlockedIntervals: [],
      adjustments: [adj({ adjustmentId: 1, adjustmentType: 'CLOSE_DAY' })],
    });
    expect(r.effectiveWindows).toEqual([]);
    expect(r.closedByAdjustment).toBe(true);
  });

  it('REPLACE_WINDOWS replaces base', () => {
    const r = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: base,
      baseBlockedIntervals: [],
      adjustments: [
        adj({
          adjustmentId: 1,
          adjustmentType: 'REPLACE_WINDOWS',
          windows: [win('16:00', '23:00')],
        }),
      ],
    });
    expect(r.effectiveWindows).toHaveLength(1);
    expect(r.effectiveWindows[0].start).toBe('16:00');
    expect(r.effectiveWindows[0].end).toBe('23:00');
    expect(r.replacedByAdjustment).toBe(true);
  });

  it('ADD_WINDOW merges with base', () => {
    const r = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: base,
      baseBlockedIntervals: [],
      adjustments: [
        adj({
          adjustmentId: 1,
          adjustmentType: 'ADD_WINDOW',
          windows: [win('19:00', '23:00')],
        }),
      ],
    });
    expect(r.effectiveWindows).toHaveLength(2);
    expect(r.extendedByAdjustment).toBe(true);
  });

  it('BLOCK_WINDOW accumulates blocks', () => {
    const r = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: [win('11:00', '23:00')],
      baseBlockedIntervals: [],
      adjustments: [
        adj({
          adjustmentId: 1,
          adjustmentType: 'BLOCK_WINDOW',
          windows: [win('15:00', '17:00')],
        }),
      ],
    });
    expect(r.effectiveWindows).toHaveLength(1);
    expect(r.blockedIntervals).toHaveLength(1);
    expect(r.blockedByAdjustment).toBe(true);
  });

  it('CLOSE then ADD reopens; ADD then CLOSE closes', () => {
    const reopen = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: base,
      baseBlockedIntervals: [],
      adjustments: [
        adj({ adjustmentId: 1, adjustmentType: 'CLOSE_DAY', createdAt: '2026-08-03T10:00:00Z' }),
        adj({
          adjustmentId: 2,
          adjustmentType: 'ADD_WINDOW',
          createdAt: '2026-08-03T11:00:00Z',
          windows: [win('14:00', '18:00')],
        }),
      ],
    });
    expect(reopen.effectiveWindows).toHaveLength(1);
    expect(reopen.closedByAdjustment).toBe(false);

    const closed = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: base,
      baseBlockedIntervals: [],
      adjustments: [
        adj({
          adjustmentId: 1,
          adjustmentType: 'ADD_WINDOW',
          createdAt: '2026-08-03T10:00:00Z',
          windows: [win('19:00', '21:00')],
        }),
        adj({ adjustmentId: 2, adjustmentType: 'CLOSE_DAY', createdAt: '2026-08-03T11:00:00Z' }),
      ],
    });
    expect(closed.effectiveWindows).toEqual([]);
    expect(closed.closedByAdjustment).toBe(true);
  });

  it('REPLACE then ADD keeps replace+adds; ADD then REPLACE keeps only replace', () => {
    const replaceThenAdd = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: base,
      baseBlockedIntervals: [],
      adjustments: [
        adj({
          adjustmentId: 1,
          adjustmentType: 'REPLACE_WINDOWS',
          createdAt: '2026-08-03T10:00:00Z',
          windows: [win('12:00', '14:00')],
        }),
        adj({
          adjustmentId: 2,
          adjustmentType: 'ADD_WINDOW',
          createdAt: '2026-08-03T11:00:00Z',
          windows: [win('16:00', '18:00')],
        }),
      ],
    });
    expect(replaceThenAdd.effectiveWindows).toHaveLength(2);

    const addThenReplace = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: base,
      baseBlockedIntervals: [],
      adjustments: [
        adj({
          adjustmentId: 1,
          adjustmentType: 'ADD_WINDOW',
          createdAt: '2026-08-03T10:00:00Z',
          windows: [win('19:00', '21:00')],
        }),
        adj({
          adjustmentId: 2,
          adjustmentType: 'REPLACE_WINDOWS',
          createdAt: '2026-08-03T11:00:00Z',
          windows: [win('13:00', '15:00')],
        }),
      ],
    });
    expect(addThenReplace.effectiveWindows).toHaveLength(1);
    expect(addThenReplace.effectiveWindows[0].start).toBe('13:00');
  });

  it('multiple REPLACE — last wins', () => {
    const r = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: base,
      baseBlockedIntervals: [],
      adjustments: [
        adj({
          adjustmentId: 1,
          adjustmentType: 'REPLACE_WINDOWS',
          createdAt: '2026-08-03T10:00:00Z',
          windows: [win('09:00', '10:00')],
        }),
        adj({
          adjustmentId: 2,
          adjustmentType: 'REPLACE_WINDOWS',
          createdAt: '2026-08-03T12:00:00Z',
          windows: [win('16:00', '20:00')],
        }),
      ],
    });
    expect(r.effectiveWindows).toHaveLength(1);
    expect(r.effectiveWindows[0].start).toBe('16:00');
  });

  it('REPLACE then BLOCK keeps windows with blocks', () => {
    const r = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: base,
      baseBlockedIntervals: [],
      adjustments: [
        adj({
          adjustmentId: 1,
          adjustmentType: 'REPLACE_WINDOWS',
          createdAt: '2026-08-03T10:00:00Z',
          windows: [win('11:00', '23:00')],
        }),
        adj({
          adjustmentId: 2,
          adjustmentType: 'BLOCK_WINDOW',
          createdAt: '2026-08-03T11:00:00Z',
          windows: [win('15:00', '17:00')],
        }),
      ],
    });
    expect(r.effectiveWindows[0].start).toBe('11:00');
    expect(r.blockedIntervals).toHaveLength(1);
  });

  it('overnight ADD_WINDOW works', () => {
    const r = applyDailyAdjustments({
      employeeId: 10,
      businessDate: DATE,
      baseWindows: [win('11:00', '17:00')],
      baseBlockedIntervals: [],
      adjustments: [
        adj({
          adjustmentId: 1,
          adjustmentType: 'ADD_WINDOW',
          windows: [win('22:00', '02:00', 1)],
        }),
      ],
    });
    expect(r.effectiveWindows.some((w) => w.endDayOffset === 1)).toBe(true);
  });

  it('merges overlapping and adjacent windows', () => {
    const merged = mergeWorkingWindows(
      [win('10:00', '12:00'), win('11:30', '14:00'), win('14:00', '15:00')],
      DATE,
      TZ,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].start).toBe('10:00');
    expect(merged[0].end).toBe('15:00');
  });

  it('full-day block is detected', () => {
    const windows = [win('11:00', '17:00')];
    const blocks = [
      {
        startMs: windows[0].startMs,
        endMs: windows[0].endMs,
        adjustmentId: 9,
      },
    ];
    expect(isFullyBlockedByIntervals(windows, blocks)).toBe(true);
  });
});

describe('Phase 3A — resolver compatibility', () => {
  it('weekly base + REPLACE', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: baseInputs({
        dailyAdjustmentsMap: new Map([
          [
            10,
            [
              adj({
                adjustmentId: 1,
                adjustmentType: 'REPLACE_WINDOWS',
                windows: [win('16:00', '23:00')],
              }),
            ],
          ],
        ]),
      }),
    });
    expect(plan.isWorking).toBe(true);
    expect(plan.effectiveWindows[0].start).toBe('16:00');
    expect(plan.dailyAdjustmentState).toBe('REPLACED');
  });

  it('legacy day_off + ADD_WINDOW can reopen', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: baseInputs({
        overridesMap: new Map([
          [
            10,
            [
              {
                OverrideID: 1,
                EmpID: 10,
                OverrideDate: DATE,
                Type: 'day_off',
                StartTime: null,
                EndTime: null,
                Reason: 'اجازة',
                IsActive: true,
                CreatedAt: '2026-08-01T00:00:00Z',
                CreatedBy: 'test',
              },
            ],
          ],
        ]),
        dailyAdjustmentsMap: new Map([
          [
            10,
            [
              adj({
                adjustmentId: 2,
                adjustmentType: 'ADD_WINDOW',
                windows: [win('14:00', '18:00')],
              }),
            ],
          ],
        ]),
      }),
    });
    expect(plan.isWorking).toBe(true);
    expect(plan.effectiveWindows[0].start).toBe('14:00');
  });

  it('legacy custom_hours + REPLACE → new windows win', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: baseInputs({
        overridesMap: new Map([
          [
            10,
            [
              {
                OverrideID: 1,
                EmpID: 10,
                OverrideDate: DATE,
                Type: 'custom_hours',
                StartTime: '09:00',
                EndTime: '12:00',
                Reason: null,
                IsActive: true,
                CreatedAt: '2026-08-01T00:00:00Z',
                CreatedBy: 'test',
              },
            ],
          ],
        ]),
        dailyAdjustmentsMap: new Map([
          [
            10,
            [
              adj({
                adjustmentId: 2,
                adjustmentType: 'REPLACE_WINDOWS',
                windows: [win('16:00', '20:00')],
              }),
            ],
          ],
        ]),
      }),
    });
    expect(plan.effectiveWindows[0].start).toBe('16:00');
    expect(plan.appliedOverrides[0].Type).toBe('custom_hours');
  });

  it('attendance Absent cannot be reopened by ADD_WINDOW', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: baseInputs({
        absentEmpIds: new Set([10]),
        dailyAdjustmentsMap: new Map([
          [
            10,
            [
              adj({
                adjustmentId: 1,
                adjustmentType: 'ADD_WINDOW',
                windows: [win('10:00', '18:00')],
              }),
            ],
          ],
        ]),
      }),
    });
    expect(plan.isWorking).toBe(false);
    expect(plan.denyReasonCode).toBe('EMPLOYEE_ABSENT');
  });

  it('CLOSE_DAY deny reason', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: baseInputs({
        dailyAdjustmentsMap: new Map([
          [10, [adj({ adjustmentId: 1, adjustmentType: 'CLOSE_DAY' })]],
        ]),
      }),
    });
    expect(plan.denyReasonCode).toBe('DAY_CLOSED_BY_ADJUSTMENT');
    expect(plan.dailyAdjustmentState).toBe('CLOSED');
  });

  it('full block deny reason + tagged daily_adjustment intervals', () => {
    const day = win('11:00', '17:00');
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: baseInputs({
        dailyAdjustmentsMap: new Map([
          [
            10,
            [
              adj({
                adjustmentId: 1,
                adjustmentType: 'BLOCK_WINDOW',
                windows: [day],
              }),
            ],
          ],
        ]),
      }),
    });
    expect(plan.denyReasonCode).toBe('NO_USABLE_WINDOW_AFTER_ADJUSTMENTS');
    expect(plan.effSched?.blockedIntervals[0].reason).toMatch(/^daily_adjustment:/);
  });

  it('freelance unlock + ADD_WINDOW', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: baseInputs({
        windowsMap: new Map([
          [10, { isWorkingDay: false, startTime: null, endTime: null }],
        ]),
        freelanceUnlocks: new Map([
          [
            10,
            {
              start: '12:00',
              end: '16:00',
              attendanceStatus: 'Present',
              checkInTime: '12:00',
              checkOutTime: null,
            },
          ],
        ]),
        dailyAdjustmentsMap: new Map([
          [
            10,
            [
              adj({
                adjustmentId: 1,
                adjustmentType: 'ADD_WINDOW',
                windows: [win('18:00', '20:00')],
              }),
            ],
          ],
        ]),
      }),
    });
    expect(plan.baseScheduleSource).toBe('FREELANCE_UNLOCK');
    expect(plan.isWorking).toBe(true);
    expect(plan.effectiveWindows.length).toBeGreaterThanOrEqual(2);
  });

  it('temporary transfer source preserved with adjustment', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 2,
      businessDate: DATE,
      inputs: baseInputs({
        windowsMap: new Map([
          [
            10,
            {
              isWorkingDay: true,
              startTime: '10:00',
              endTime: '18:00',
              source: 'TEMPORARY_TRANSFER',
            },
          ],
        ]),
        dailyAdjustmentsMap: new Map([
          [
            10,
            [
              adj({
                adjustmentId: 1,
                adjustmentType: 'BLOCK_WINDOW',
                windows: [win('12:00', '13:00')],
              }),
            ],
          ],
        ]),
      }),
    });
    expect(plan.baseScheduleSource).toBe('TEMPORARY_TRANSFER');
    expect(plan.isWorking).toBe(true);
    expect(plan.effSched?.blockedIntervals.length).toBe(1);
  });

  it('no adjustments preserves prior behavior', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: baseInputs(),
    });
    expect(plan.isWorking).toBe(true);
    expect(plan.dailyAdjustmentState).toBe('NONE');
    expect(plan.denyReasonCode).toBeNull();
  });
});

describe('Phase 3A — consumers and explain', () => {
  it('slot engine maps daily_adjustment block reason', () => {
    const startMs = salonDateTimeToMs(DATE, '12:00', TZ);
    const r = evaluateBookingSlotAt(startMs, 30, [], {
      shiftStartMs: salonDateTimeToMs(DATE, '11:00', TZ),
      shiftEndMs: salonDateTimeToMs(DATE, '17:00', TZ),
      overrideBlock: true,
      overrideBlockReason: 'daily_adjustment:استراحة',
    });
    expect(r.available).toBe(false);
    expect(r.reasonCode).toBe('daily_adjustment');
    expect(mapLegacySlotReason(r.reasonCode)).toBe('BLOCKED_BY_DAILY_ADJUSTMENT');
  });

  it('explain timeline includes daily adjustment steps', () => {
    const plan = buildEmployeeDayPlanFromInputs({
      empId: 10,
      branchId: 1,
      businessDate: DATE,
      inputs: baseInputs({
        dailyAdjustmentsMap: new Map([
          [
            10,
            [
              adj({ adjustmentId: 1, adjustmentType: 'CLOSE_DAY' }),
              adj({
                adjustmentId: 2,
                adjustmentType: 'ADD_WINDOW',
                createdAt: '2026-08-03T12:00:00Z',
                windows: [win('14:00', '16:00')],
              }),
            ],
          ],
        ]),
      }),
    });
    const explained = explainEmployeeDayPlan(plan);
    expect(explained.dailyAdjustments.length).toBe(2);
    expect(explained.dailyAdjustmentState).toBe('MIXED');
    const steps = explained.evaluationTimeline.map((t) => t.step);
    expect(steps).toContain('DAILY_CLOSE_APPLIED');
    expect(steps).toContain('DAILY_WINDOW_ADDED');
    expect(steps).toContain('FINAL_WINDOWS_NORMALIZED');
  });

  it('inferDailyAdjustmentState covers single and mixed', () => {
    expect(inferDailyAdjustmentState([])).toBe('NONE');
    expect(
      inferDailyAdjustmentState([adj({ adjustmentId: 1, adjustmentType: 'BLOCK_WINDOW' })]),
    ).toBe('BLOCKED');
    expect(
      inferDailyAdjustmentState([
        adj({ adjustmentId: 1, adjustmentType: 'CLOSE_DAY' }),
        adj({ adjustmentId: 2, adjustmentType: 'ADD_WINDOW' }),
      ]),
    ).toBe('MIXED');
  });
});

describe('Phase 3A — loader / service source contracts', () => {
  it('batch loader uses two queries and EmpID IN list', () => {
    const src = read('src/lib/availability/loadDailyAdjustmentsBatch.ts');
    expect(src).toContain('EmpID IN (');
    expect(src).toContain('TblEmpDailyAdjustmentWindow');
    expect(src).toContain('CancelledAt IS NULL');
    expect(src).toContain('IsActive = 1');
    expect(src).toContain('ORDER BY AdjustmentID, SortOrder');
    expect(src).toContain('transaction?: Transaction');
  });

  it('inputs batch includes dailyAdjustmentsMap', () => {
    const src = read('src/lib/availability/loadEmployeeDayPlanInputsBatch.ts');
    expect(src).toContain('dailyAdjustmentsMap');
    expect(src).toContain('loadDailyAdjustmentsBatch');
  });

  it('service soft-cancels and validates assignment', () => {
    const src = read('src/lib/availability/dailyAdjustmentService.ts');
    expect(src).toContain('CancelledAt');
    expect(src).toContain('IsActive = 0');
    expect(src).toContain('isEmployeeEligibleForBranchBookings');
    expect(src).toContain('transaction.begin');
  });
});
