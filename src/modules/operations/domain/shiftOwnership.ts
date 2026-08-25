import { BranchDomainError } from '@/lib/branch/types';
import type { BusinessDayRecord } from '@/lib/branch/businessDay';
import type { ShiftMoveRecord } from '../infra/shiftMoveRecord';

/**
 * An OPEN shift must belong to an OPEN business day on the same branch:
 *   shift.BranchID == day.BranchID
 *   shift.BusinessDayID == day.ID
 *   (day.Status == OPEN is enforced by the caller when the day is a write target)
 */
export function assertDayShiftOwnership(
  branchId: number,
  day: BusinessDayRecord,
  shift: ShiftMoveRecord | null,
): void {
  if (day.branchId !== branchId) {
    throw new BranchDomainError(
      'OPERATIONAL_OWNERSHIP_MISMATCH',
      'يوم العمل لا ينتمي للفرع المحدد',
      400,
    );
  }
  if (!shift) return;
  if (shift.branchId !== branchId) {
    throw new BranchDomainError(
      'SHIFT_BRANCH_MISMATCH',
      'الوردية لا تنتمي للفرع النشط',
      400,
    );
  }
  if (shift.businessDayId !== day.id) {
    throw new BranchDomainError(
      'SHIFT_DAY_MISMATCH',
      'الوردية لا تنتمي ليوم العمل النشط',
      400,
    );
  }
  if (shift.branchId !== day.branchId) {
    throw new BranchDomainError(
      'OPERATIONAL_OWNERSHIP_MISMATCH',
      'تعارض ملكية الفرع بين اليوم والوردية',
      400,
    );
  }
  if (shift.newDay && day.newDay && shift.newDay !== day.newDay) {
    throw new BranchDomainError(
      'OPERATIONAL_OWNERSHIP_MISMATCH',
      'تعارض تاريخ اليوم التشغيلي بين اليوم والوردية',
      400,
    );
  }
}

export function assertTargetDayIsOpenForShift(
  branchId: number,
  day: BusinessDayRecord | null,
): asserts day is BusinessDayRecord {
  if (!day) {
    throw new BranchDomainError(
      'NO_OPEN_DAY',
      'لا يوجد يوم عمل مفتوح لهذا الفرع — يجب فتح يوم أولاً',
      400,
    );
  }
  if (day.branchId !== branchId) {
    throw new BranchDomainError(
      'OPERATIONAL_OWNERSHIP_MISMATCH',
      'يوم العمل لا ينتمي للفرع المحدد',
      400,
    );
  }
  if (!day.status) {
    throw new BranchDomainError(
      'BUSINESS_DAY_CLOSED',
      'لا يوجد يوم عمل مفتوح لهذا الفرع — يجب فتح يوم أولاً',
      400,
    );
  }
}
