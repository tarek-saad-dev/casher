/**
 * Phase 3B / 3B.2 — Workforce day board loader (batch, no N+1 resolver).
 */

import 'server-only';
import { getPool, sql } from '@/lib/db';
import { BARBER_JOBS_SQL_LIST } from '@/lib/availabilityEngine';
import { resolveEmployeeDayPlansBatch } from '@/lib/availability/resolveEmployeeDayPlan';
import { explainEmployeeDayPlan } from '@/lib/availability/explainAvailability';
import {
  BUSINESS_DAY_CUTOFF_HOUR,
  SALON_TZ,
} from '@/lib/businessDate';
import { isValidBusinessDate } from '@/lib/availability/dailyAdjustments';
import {
  inferWorkforceUiStatus,
  reasonCodeLabelAr,
  type WorkforceUiStatusKey,
} from '@/lib/availability/workforceUiLabels';
import type { AvailabilityExplanation } from '@/lib/availability/explainAvailability';
import type { EmployeeDailyAdjustment } from '@/lib/availability/dailyAdjustments';
import {
  buildAvailabilityLayers,
  getAvailabilityDecisionFromLayers,
  DEFAULT_WORKFORCE_LAYER_PERMISSIONS,
  type AvailabilityLayerView,
  type ScheduledElsewhereMeta,
  type TransferMeta,
  type WorkforceLayerPermissions,
} from '@/lib/availability/buildAvailabilityLayers';
import type { AvailabilityDecisionExplain } from '@/lib/availability/buildAvailabilityDecision';
import { loadWorkingElsewhereBatch } from '@/lib/availability/loadWorkingWindowsBatch';
import { normalizeEmploymentType } from '@/lib/hr/employee-hr-model';
import { WORKFORCE_UI_STATUS_AR } from '@/lib/availability/workforceUiLabels';

export type WorkforceDayEmployee = {
  employeeId: number;
  employeeName: string;
  job: string | null;
  isActive: boolean;
  employmentType: string | null;
  uiStatus: { key: WorkforceUiStatusKey; labelAr: string };
  reasonLabelAr: string | null;
  decision: AvailabilityDecisionExplain | null;
  scheduledElsewhere: ScheduledElsewhereMeta | null;
  dayPlan: {
    isWorking: boolean;
    baseScheduleSource: string;
    weeklyWindows: unknown;
    effectiveWindows: Array<{
      start: string;
      end: string;
      endDayOffset: 0 | 1;
      startMs: number;
      endMs: number;
    }>;
    blockedIntervals: Array<{
      startMs: number;
      endMs: number;
      reason?: string;
    }>;
    attendanceState: unknown;
    denyReasonCode: string | null;
    warnings: string[];
    isOvernight: boolean;
    dailyAdjustmentState: string;
  };
  dailyAdjustments: EmployeeDailyAdjustment[];
  explanation: AvailabilityExplanation;
  /** Phase 3B.2 */
  transfer: TransferMeta;
  layers: AvailabilityLayerView[];
};

export type WorkforceDayPayload = {
  ok: true;
  branch: { id: number; code: string; name: string };
  businessDate: string;
  timezone: string;
  cutoffHour: number;
  permissions: WorkforceLayerPermissions;
  employees: WorkforceDayEmployee[];
};

type RosterRow = {
  employeeId: number;
  employeeName: string;
  job: string | null;
  isActive: boolean;
  employmentType: string | null;
  assignmentEffectiveFrom: string | null;
  assignmentEffectiveTo: string | null;
  isAssignedToActiveBranch: boolean;
};

async function listBranchWorkforceEmployees(
  branchId: number,
  businessDate: string,
): Promise<RosterRow[]> {
  const db = await getPool();
  const res = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('day', sql.Date, businessDate)
    .query(`
      SELECT DISTINCT
        e.EmpID AS employeeId,
        e.EmpName AS employeeName,
        e.Job AS job,
        CAST(ISNULL(e.isActive, 1) AS BIT) AS isActive,
        e.EmploymentType AS employmentType,
        (
          SELECT TOP 1 CONVERT(VARCHAR(10), ea.EffectiveFrom, 120)
          FROM dbo.TblEmpBranchAssignment ea
          WHERE ea.EmpID = e.EmpID
            AND ea.BranchID = @branchId
            AND ea.IsActive = 1
            AND ea.EffectiveFrom <= @day
            AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
          ORDER BY ea.EffectiveFrom DESC
        ) AS assignmentEffectiveFrom,
        (
          SELECT TOP 1 CONVERT(VARCHAR(10), ea.EffectiveTo, 120)
          FROM dbo.TblEmpBranchAssignment ea
          WHERE ea.EmpID = e.EmpID
            AND ea.BranchID = @branchId
            AND ea.IsActive = 1
            AND ea.EffectiveFrom <= @day
            AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
          ORDER BY ea.EffectiveFrom DESC
        ) AS assignmentEffectiveTo,
        CAST(
          CASE WHEN EXISTS (
            SELECT 1 FROM dbo.TblEmpBranchAssignment ea
            WHERE ea.EmpID = e.EmpID AND ea.BranchID = @branchId AND ea.IsActive = 1
              AND ea.EffectiveFrom <= @day
              AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
          ) THEN 1 ELSE 0 END
        AS BIT) AS isAssignedToActiveBranch
      FROM dbo.TblEmp e
      WHERE ISNULL(e.isActive, 1) = 1
        AND e.Job IN (${BARBER_JOBS_SQL_LIST})
        AND (
          EXISTS (
            SELECT 1
            FROM dbo.TblEmpBranchAssignment ea
            WHERE ea.EmpID = e.EmpID
              AND ea.BranchID = @branchId
              AND ea.IsActive = 1
              AND ea.EffectiveFrom <= @day
              AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
          )
          OR EXISTS (
            SELECT 1
            FROM dbo.TblEmpTemporaryBranchTransfer tt
            WHERE tt.EmpID = e.EmpID
              AND tt.ToBranchID = @branchId
              AND tt.WorkDate = @day
              AND tt.IsActive = 1
          )
        )
      ORDER BY e.EmpName
    `);

  return (res.recordset as Array<Record<string, unknown>>).map((r) => ({
    employeeId: Number(r.employeeId),
    employeeName: String(r.employeeName ?? ''),
    job: r.job != null ? String(r.job) : null,
    isActive: Boolean(r.isActive),
    employmentType: normalizeEmploymentType(
      r.employmentType != null ? String(r.employmentType) : null,
    ),
    assignmentEffectiveFrom:
      r.assignmentEffectiveFrom != null ? String(r.assignmentEffectiveFrom).slice(0, 10) : null,
    assignmentEffectiveTo:
      r.assignmentEffectiveTo != null ? String(r.assignmentEffectiveTo).slice(0, 10) : null,
    isAssignedToActiveBranch: Boolean(r.isAssignedToActiveBranch),
  }));
}

function fmtTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

/** Batch transfer rows for the operational date (in + away). */
async function loadTransfersBatch(
  empIds: number[],
  branchId: number,
  businessDate: string,
): Promise<Map<number, TransferMeta>> {
  const map = new Map<number, TransferMeta>();
  for (const id of empIds) map.set(id, { direction: 'none' });
  if (!empIds.length) return map;

  const db = await getPool();
  try {
    const res = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .input('day', sql.Date, businessDate)
      .query(`
        SELECT
          tt.EmpID,
          tt.FromBranchID,
          tt.ToBranchID,
          tt.StartTime,
          tt.EndTime,
          CONVERT(VARCHAR(10), tt.WorkDate, 120) AS WorkDate,
          fb.BranchName AS FromBranchName,
          tb.BranchName AS ToBranchName
        FROM dbo.TblEmpTemporaryBranchTransfer tt
        LEFT JOIN dbo.TblBranch fb ON fb.BranchID = tt.FromBranchID
        LEFT JOIN dbo.TblBranch tb ON tb.BranchID = tt.ToBranchID
        WHERE tt.WorkDate = @day AND tt.IsActive = 1
          AND tt.EmpID IN (${empIds.join(',')})
          AND (tt.ToBranchID = @branchId OR tt.FromBranchID = @branchId)
      `);

    for (const row of res.recordset as Array<Record<string, unknown>>) {
      const empId = Number(row.EmpID);
      const toId = Number(row.ToBranchID);
      const fromId = row.FromBranchID != null ? Number(row.FromBranchID) : null;
      const direction: TransferMeta['direction'] =
        toId === branchId ? 'in' : fromId === branchId ? 'away' : 'none';
      map.set(empId, {
        direction,
        fromBranchId: fromId,
        fromBranchName: row.FromBranchName != null ? String(row.FromBranchName) : null,
        toBranchId: toId,
        toBranchName: row.ToBranchName != null ? String(row.ToBranchName) : null,
        startTime: fmtTime(row.StartTime),
        endTime: fmtTime(row.EndTime),
        workDate: row.WorkDate != null ? String(row.WorkDate).slice(0, 10) : businessDate,
      });
    }
  } catch {
    /* optional table */
  }
  return map;
}

export async function loadWorkforceDay(args: {
  branchId: number;
  branchCode: string;
  branchName: string;
  businessDate: string;
  permissions?: WorkforceLayerPermissions;
}): Promise<WorkforceDayPayload> {
  if (!isValidBusinessDate(args.businessDate)) {
    throw new Error('INVALID_DATE');
  }

  const permissions = args.permissions ?? DEFAULT_WORKFORCE_LAYER_PERMISSIONS;
  const roster = await listBranchWorkforceEmployees(args.branchId, args.businessDate);
  const empIds = roster.map((e) => e.employeeId);
  const dayOfWeek = new Date(`${args.businessDate}T12:00:00Z`).getUTCDay();
  const db = await getPool();

  const [plans, transfers, elsewhereMap] = await Promise.all([
    resolveEmployeeDayPlansBatch({
      empIds,
      businessDate: args.businessDate,
      branchId: args.branchId,
      source: 'admin',
    }),
    loadTransfersBatch(empIds, args.branchId, args.businessDate),
    loadWorkingElsewhereBatch(
      db,
      empIds,
      dayOfWeek,
      args.branchId,
      args.businessDate,
    ),
  ]);

  const employees: WorkforceDayEmployee[] = roster.map((row) => {
    const transfer = transfers.get(row.employeeId) ?? { direction: 'none' as const };
    const elsewhereRaw = elsewhereMap.get(row.employeeId) ?? null;
    const scheduledElsewhere: ScheduledElsewhereMeta | null = elsewhereRaw
      ? {
          branchId: elsewhereRaw.branchId,
          branchCode: elsewhereRaw.branchCode,
          branchName: elsewhereRaw.branchName,
          startTime: elsewhereRaw.startTime,
          endTime: elsewhereRaw.endTime,
        }
      : null;
    const plan = plans.get(row.employeeId);

    if (!plan) {
      const emptyPlan = {
        employeeId: row.employeeId,
        branchId: args.branchId,
        businessDate: args.businessDate,
        isWorking: false,
        effectiveWindows: [],
        baseScheduleSource: 'NONE' as const,
        weeklyWindows: null,
        appliedOverrides: [],
        attendanceState: null,
        denyReasonCode: 'SCHEDULE_NOT_CONFIGURED' as const,
        warnings: [],
        effSched: null,
        isOvernight: false,
        dailyAdjustments: [],
        dailyAdjustmentState: 'NONE' as const,
      };
      const emptyExplanation = explainEmployeeDayPlan(emptyPlan);
      const layers = buildAvailabilityLayers({
        employee: {
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          job: row.job,
          isActive: row.isActive,
          employmentType: row.employmentType,
          assignment: {
            branchId: args.branchId,
            branchName: args.branchName,
            effectiveFrom: row.assignmentEffectiveFrom,
            effectiveTo: row.assignmentEffectiveTo,
            isAssignedToActiveBranch: row.isAssignedToActiveBranch,
          },
          transfer,
          scheduledElsewhere,
        },
        dayPlan: emptyPlan,
        explanation: emptyExplanation,
        activeAdjustments: [],
        permissions,
        activeBranchId: args.branchId,
        activeBranchName: args.branchName,
      });
      const decision = getAvailabilityDecisionFromLayers(layers);
      const uiStatus =
        decision?.outcomeKey === 'scheduled_elsewhere'
          ? {
              key: 'scheduled_elsewhere' as const,
              labelAr: WORKFORCE_UI_STATUS_AR.scheduled_elsewhere,
            }
          : inferWorkforceUiStatus({
              isWorking: false,
              denyReasonCode: 'SCHEDULE_NOT_CONFIGURED',
              blockedIntervals: [],
            });
      return {
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        job: row.job,
        isActive: row.isActive,
        employmentType: row.employmentType,
        uiStatus,
        reasonLabelAr:
          decision?.reasonLabelAr ?? reasonCodeLabelAr('SCHEDULE_NOT_CONFIGURED'),
        decision,
        scheduledElsewhere,
        dayPlan: {
          isWorking: false,
          baseScheduleSource: 'NONE',
          weeklyWindows: null,
          effectiveWindows: [],
          blockedIntervals: [],
          attendanceState: null,
          denyReasonCode: 'SCHEDULE_NOT_CONFIGURED',
          warnings: [],
          isOvernight: false,
          dailyAdjustmentState: 'NONE',
        },
        dailyAdjustments: [],
        explanation: emptyExplanation,
        transfer,
        layers,
      };
    }

    const blockedIntervals = (plan.effSched?.blockedIntervals ?? []).map((iv) => ({
      startMs: iv.startMs,
      endMs: iv.endMs,
      reason: iv.reason,
    }));
    const explanation = explainEmployeeDayPlan(plan);
    const layers = buildAvailabilityLayers({
      employee: {
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        job: row.job,
        isActive: row.isActive,
        employmentType: row.employmentType,
        assignment: {
          branchId: args.branchId,
          branchName: args.branchName,
          effectiveFrom: row.assignmentEffectiveFrom,
          effectiveTo: row.assignmentEffectiveTo,
          isAssignedToActiveBranch: row.isAssignedToActiveBranch,
        },
        transfer,
        scheduledElsewhere,
      },
      dayPlan: plan,
      explanation,
      activeAdjustments: plan.dailyAdjustments,
      permissions,
      activeBranchId: args.branchId,
      activeBranchName: args.branchName,
    });
    const decision = getAvailabilityDecisionFromLayers(layers);
    const uiStatus =
      decision?.outcomeKey === 'scheduled_elsewhere'
        ? {
            key: 'scheduled_elsewhere' as const,
            labelAr: WORKFORCE_UI_STATUS_AR.scheduled_elsewhere,
          }
        : inferWorkforceUiStatus({
            isWorking: plan.isWorking,
            denyReasonCode: plan.denyReasonCode,
            blockedIntervals,
            dailyAdjustmentState: plan.dailyAdjustmentState,
          });

    return {
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      job: row.job,
      isActive: row.isActive,
      employmentType: row.employmentType,
      uiStatus,
      reasonLabelAr: decision?.reasonLabelAr ?? reasonCodeLabelAr(plan.denyReasonCode),
      decision,
      scheduledElsewhere,
      dayPlan: {
        isWorking: plan.isWorking,
        baseScheduleSource: plan.baseScheduleSource,
        weeklyWindows: plan.weeklyWindows,
        effectiveWindows: plan.effectiveWindows,
        blockedIntervals,
        attendanceState: plan.attendanceState,
        denyReasonCode: plan.denyReasonCode,
        warnings: plan.warnings,
        isOvernight: plan.isOvernight,
        dailyAdjustmentState: plan.dailyAdjustmentState,
      },
      dailyAdjustments: plan.dailyAdjustments,
      explanation,
      transfer,
      layers,
    };
  });

  return {
    ok: true,
    branch: {
      id: args.branchId,
      code: args.branchCode,
      name: args.branchName,
    },
    businessDate: args.businessDate,
    timezone: SALON_TZ,
    cutoffHour: BUSINESS_DAY_CUTOFF_HOUR,
    permissions,
    employees,
  };
}
