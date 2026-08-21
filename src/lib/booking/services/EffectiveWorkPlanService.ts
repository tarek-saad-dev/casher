/**
 * Booking V2 — EffectiveWorkPlanService
 *
 * Loads / builds the employee effective work plan for a BusinessDate.
 * Delegates to the canonical day-plan resolver (no forked schedule math).
 *
 * Safe to call from domain services; not from Next.js route handlers directly
 * for new code — go through BookingCommandService when possible.
 */

import type { Transaction } from 'mssql';
import {
  buildEmployeeDayPlanFromInputs,
  resolveEmployeeDayPlan,
  resolveEmployeeDayPlansBatch,
  type EmployeeDayPlan,
} from '@/lib/availability/resolveEmployeeDayPlan';
import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import { parseBusinessDate, type BusinessDateString } from '@/lib/booking/domain/BusinessDate';
import { BookingPolicy } from '@/lib/booking/domain/BookingPolicy';

export type EffectiveWorkPlanQuery = {
  employeeId: number;
  branchId: number | null;
  businessDate: BusinessDateString | string;
  source?: 'public' | 'operations' | 'admin';
  transaction?: Transaction;
};

export const EffectiveWorkPlanService = {
  /** Pure — no DB. Prefer in unit tests and policy evaluation. */
  buildFromInputs(args: {
    employeeId: number;
    branchId: number | null;
    businessDate: BusinessDateString | string;
    inputs: EmployeeDayPlanBatchInputs;
  }): EmployeeDayPlan {
    return BookingPolicy.buildWorkPlan(args);
  },

  /** DB-backed single employee plan (existing canonical reader). */
  async resolve(query: EffectiveWorkPlanQuery): Promise<EmployeeDayPlan> {
    const businessDate = String(parseBusinessDate(query.businessDate));
    return resolveEmployeeDayPlan({
      empId: query.employeeId,
      branchId: query.branchId,
      businessDate,
      source: query.source,
      transaction: query.transaction,
    });
  },

  /** DB-backed batch — same EmpID is one global identity; branch scopes the plan. */
  async resolveBatch(args: {
    employeeIds: number[];
    branchId: number | null;
    businessDate: BusinessDateString | string;
    source?: 'public' | 'operations' | 'admin';
    transaction?: Transaction;
  }): Promise<Map<number, EmployeeDayPlan>> {
    const businessDate = String(parseBusinessDate(args.businessDate));
    return resolveEmployeeDayPlansBatch({
      empIds: args.employeeIds,
      branchId: args.branchId,
      businessDate,
      source: args.source,
      transaction: args.transaction,
    });
  },
};

/** Re-export builder for callers that already hold batch inputs. */
export { buildEmployeeDayPlanFromInputs };
