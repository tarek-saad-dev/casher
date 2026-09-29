import 'server-only';
import { getBranchBusinessDate } from '@/lib/branch/businessDay';
import { getOpenBusinessDay } from '@/lib/branch/businessDay';
import type {
  CloseDayResult,
  CloseShiftResult,
  FinancialWriteContext,
  OpenDayResult,
  OpenShiftResult,
  OperationalCalendarPort,
} from '../public/ports';
import { resolveFinancialWriteContextInTransaction } from './resolveFinancialWriteContext';
import {
  closeDayInTransaction,
  closeShiftInTransactionForActor,
  openDayInTransaction,
  openShiftInTransaction,
} from './calendarMutations';

/**
 * Operational Calendar facade over legacy day/shift resolve and lock behavior.
 * Financial resolution and mutations honor the caller-supplied transaction.
 */
export function createLegacyOperationalCalendarAdapter(
  tenantId: string,
): OperationalCalendarPort {
  return {
    async resolveFinancialWriteContext(tx, actor, input) {
      return resolveFinancialWriteContextInTransaction(tx, tenantId, actor, input);
    },

    async getBusinessDate(_actor, input) {
      const branch = await import('@/lib/branch/repository').then((m) =>
        m.getBranchById(input.locationId),
      );
      if (!branch) {
        throw new Error('Location not found');
      }
      return getBranchBusinessDate(branch, input.instant);
    },

    async hasOpenDay(_actor, input) {
      const open = await getOpenBusinessDay(input.locationId);
      return open?.newDay === input.businessDate;
    },

    async openDay(tx, actor, input): Promise<OpenDayResult> {
      const day = await openDayInTransaction(tx, tenantId, actor, input);
      return {
        businessDayId: day.id,
        locationId: day.branchId,
        businessDate: day.newDay,
      };
    },

    async closeDay(tx, actor, input): Promise<CloseDayResult> {
      const result = await closeDayInTransaction(tx, tenantId, actor, input);
      return {
        businessDayId: result.day.id,
        locationId: result.day.branchId,
        businessDate: result.day.newDay,
        closedShifts: result.closedShifts,
      };
    },

    async openShift(tx, actor, input): Promise<OpenShiftResult> {
      const shift = await openShiftInTransaction(tx, tenantId, actor, input);
      return {
        shiftInstanceId: shift.id,
        locationId: shift.branchId,
        businessDayId: shift.businessDayId,
        businessDate: shift.newDay,
        shiftDefinitionId: shift.shiftId,
      };
    },

    async closeShift(tx, actor, input): Promise<CloseShiftResult> {
      const shift = await closeShiftInTransactionForActor(tx, tenantId, actor, input);
      return {
        shiftInstanceId: shift.id,
        locationId: shift.branchId,
        businessDayId: shift.businessDayId,
        businessDate: shift.newDay,
      };
    },
  };
}

export type { OperationalCalendarPort, FinancialWriteContext };
