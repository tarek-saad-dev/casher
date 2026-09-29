import 'server-only';
import { sql } from '@/lib/db';
import type { ActorContext } from '@/platform/public';
import { BranchDomainError } from '@/lib/branch/types';
import { validateUserBranchAccess } from '@/lib/branch/access';
import { getBranchById } from '@/lib/branch/repository';
import {
  lockCurrentOpenBusinessDay,
  lockOperationalWrite,
} from '@/modules/operations/infra/businessDayLock';
import type { FinancialWriteContext } from '../public/ports';
import { getUserOpenShiftInTransaction } from './transactionReads';

function assertStaffActor(actor: ActorContext): number {
  if (actor.actorType !== 'staff') {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'Operational Calendar requires a staff actor',
      403,
    );
  }
  const userId = Number(actor.actorId);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new BranchDomainError(
      'USER_NOT_FOUND',
      'Operational Calendar requires staff actorId',
      401,
    );
  }
  return userId;
}

function assertTenant(actor: ActorContext, tenantId: string): void {
  if (!actor.tenantId || actor.tenantId !== tenantId) {
    throw new BranchDomainError(
      'TENANT_MISMATCH',
      'Tenant context mismatch',
      403,
    );
  }
}

/**
 * Transactionally resolve financial write scope for a staff actor.
 * Locks day (and shift when applicable) on the supplied transaction.
 */
export async function resolveFinancialWriteContextInTransaction(
  tx: sql.Transaction,
  tenantId: string,
  actor: ActorContext,
  input: { locationId: number },
): Promise<FinancialWriteContext> {
  assertTenant(actor, tenantId);
  const userId = assertStaffActor(actor);

  const openShift = await getUserOpenShiftInTransaction(tx, userId);

  if (openShift?.status) {
    const branch = await getBranchById(openShift.branchId);
    if (!branch || !branch.isActive) {
      throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 403);
    }
    await validateUserBranchAccess(userId, openShift.branchId);

    const locked = await lockOperationalWrite(tx, {
      branchId: openShift.branchId,
      businessDayId: openShift.businessDayId,
      shiftSessionId: openShift.id,
      requireShift: true,
    });

    return {
      tenantId,
      locationId: openShift.branchId,
      businessDayId: locked.day.id,
      businessDate: locked.day.newDay,
      shiftInstanceId: locked.shift?.id ?? openShift.id,
      scope: 'SHIFT',
    };
  }

  const access = await validateUserBranchAccess(userId, input.locationId);
  if (!access.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }

  const branch = await getBranchById(input.locationId);
  if (!branch || !branch.isActive) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 403);
  }

  const day = await lockCurrentOpenBusinessDay(tx, { branchId: input.locationId });

  return {
    tenantId,
    locationId: input.locationId,
    businessDayId: day.id,
    businessDate: day.newDay,
    shiftInstanceId: null,
    scope: 'DAY',
  };
}
