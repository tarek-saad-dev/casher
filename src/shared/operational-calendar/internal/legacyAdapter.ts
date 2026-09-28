import 'server-only';
import type { Transaction } from 'mssql';
import { resolveBranchDayAndShiftForWrite } from '@/lib/branch/operationalGates';
import { getBranchBusinessDate } from '@/lib/branch/businessDay';
import { getOpenBusinessDay } from '@/lib/branch/businessDay';
import type { ActorContext } from '@/platform/public';
import type { FinancialWriteContext, OperationalCalendarPort } from '../public/ports';

/**
 * Operational Calendar facade over legacy day/shift resolve and lock behavior.
 */
export function createLegacyOperationalCalendarAdapter(
  tenantId: string,
): OperationalCalendarPort {
  return {
    async resolveFinancialWriteContext(_tx, actor, input) {
      const userId = Number(actor.actorId);
      if (!Number.isFinite(userId)) {
        throw new Error('OperationalCalendar requires staff actorId');
      }
      const resolved = await resolveBranchDayAndShiftForWrite(userId);
      if (!resolved.ok) {
        throw new Error('OperationalCalendar gate failed');
      }
      const { branch, day, shift } = resolved;
      if (branch.branchId !== input.locationId) {
        /* Shift-scope writes use operational branch, not view cookie. */
      }
      return {
        tenantId,
        locationId: branch.branchId,
        businessDayId: day.id,
        businessDate: day.newDay,
        shiftInstanceId: shift?.id ?? null,
        scope: shift?.status ? 'SHIFT' : 'DAY',
      };
    },

    async getBusinessDate(_actor, input) {
      const branch = await import('@/lib/branch/repository').then((m) =>
        m.getBranchById(input.locationId),
      );
      if (!branch) throw new Error('Location not found');
      return getBranchBusinessDate(branch, input.instant);
    },

    async hasOpenDay(_actor, input) {
      const open = await getOpenBusinessDay(input.locationId);
      return open?.newDay === input.businessDate;
    },
  };
}

export type { OperationalCalendarPort, FinancialWriteContext };
