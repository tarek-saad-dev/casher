import 'server-only';
import { sql } from '@/lib/db';
import type { ActorContext } from '@/platform/public';
import { BranchDomainError } from '@/lib/branch/types';
import { validateUserBranchAccess } from '@/lib/branch/access';
import { getBranchById } from '@/lib/branch/repository';
import { resolveBusinessDate } from '@/modules/operations/clock/BusinessClock';
import {
  closeBusinessDayInTransaction,
  openBusinessDayInTransaction,
} from '@/modules/operations/infra/businessDayMutationTx';
import { lockBranchForDayMutation } from '@/modules/operations/infra/businessDayLock';
import {
  closeShiftInTransaction,
  openOrHandoffShiftInTransaction,
} from '@/modules/operations/infra/shiftMutationTx';
import type { ShiftMoveRecord } from '@/modules/operations/infra/shiftMoveRecord';
import type { BusinessDayRecord } from '@/lib/branch/businessDay';
import { publishCalendarOutboxEvent } from './calendarOutbox';

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
    throw new BranchDomainError('USER_NOT_FOUND', 'Operational Calendar requires staff actorId', 401);
  }
  return userId;
}

function assertTenant(actor: ActorContext, tenantId: string): void {
  if (!actor.tenantId || actor.tenantId !== tenantId) {
    throw new BranchDomainError('TENANT_MISMATCH', 'Tenant context mismatch', 403);
  }
}

async function assertCanOperateBranch(userId: number, locationId: number): Promise<void> {
  const access = await validateUserBranchAccess(userId, locationId);
  if (!access.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }
  const branch = await getBranchById(locationId);
  if (!branch || !branch.isActive) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 403);
  }
}

export async function openDayInTransaction(
  tx: sql.Transaction,
  tenantId: string,
  actor: ActorContext,
  input: { locationId: number; businessDate?: string },
): Promise<BusinessDayRecord> {
  assertTenant(actor, tenantId);
  const userId = assertStaffActor(actor);
  await assertCanOperateBranch(userId, input.locationId);

  const branch = await getBranchById(input.locationId);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 403);
  }

  await lockBranchForDayMutation(tx, input.locationId);
  const businessDate = input.businessDate ?? resolveBusinessDate(branch);
  const day = await openBusinessDayInTransaction(tx, {
    branchId: input.locationId,
    businessDate,
  });

  await publishCalendarOutboxEvent(
    tx,
    tenantId,
    'calendar.day.opened',
    {
      tenantId,
      locationId: input.locationId,
      businessDayId: day.id,
      businessDate: day.newDay,
      openedByUserId: userId,
    },
    `calendar.day.opened:${input.locationId}:${day.id}`,
  );

  return day;
}

export async function closeDayInTransaction(
  tx: sql.Transaction,
  tenantId: string,
  actor: ActorContext,
  input: { locationId: number; forceCloseShifts?: boolean },
): Promise<{ day: BusinessDayRecord; closedShifts: number }> {
  assertTenant(actor, tenantId);
  const userId = assertStaffActor(actor);
  await assertCanOperateBranch(userId, input.locationId);

  await lockBranchForDayMutation(tx, input.locationId);
  const result = await closeBusinessDayInTransaction(tx, {
    branchId: input.locationId,
    forceCloseShifts: input.forceCloseShifts,
  });

  await publishCalendarOutboxEvent(
    tx,
    tenantId,
    'calendar.day.closed',
    {
      tenantId,
      locationId: input.locationId,
      businessDayId: result.day.id,
      businessDate: result.day.newDay,
      closedShifts: result.closedShifts,
      closedByUserId: userId,
    },
    `calendar.day.closed:${input.locationId}:${result.day.id}`,
  );

  return result;
}

export async function openShiftInTransaction(
  tx: sql.Transaction,
  tenantId: string,
  actor: ActorContext,
  input: { locationId: number; shiftDefinitionId: number },
): Promise<ShiftMoveRecord> {
  assertTenant(actor, tenantId);
  const userId = assertStaffActor(actor);
  await assertCanOperateBranch(userId, input.locationId);

  const shift = await openOrHandoffShiftInTransaction(tx, {
    userId,
    targetBranchId: input.locationId,
    shiftId: input.shiftDefinitionId,
    mode: 'open',
  });

  await publishCalendarOutboxEvent(
    tx,
    tenantId,
    'calendar.shift.opened',
    {
      tenantId,
      locationId: shift.branchId,
      businessDayId: shift.businessDayId,
      businessDate: shift.newDay,
      shiftInstanceId: shift.id,
      shiftDefinitionId: shift.shiftId,
      userId: shift.userId,
    },
    `calendar.shift.opened:${shift.id}`,
  );

  return shift;
}

export async function closeShiftInTransactionForActor(
  tx: sql.Transaction,
  tenantId: string,
  actor: ActorContext,
  input: { shiftInstanceId: number; locationId?: number },
): Promise<ShiftMoveRecord> {
  assertTenant(actor, tenantId);
  const userId = assertStaffActor(actor);

  await assertCanOperateBranch(userId, input.locationId);

  const shift = await closeShiftInTransaction(tx, {
    shiftMoveId: input.shiftInstanceId,
    expectedBranchId: input.locationId,
  });

  await publishCalendarOutboxEvent(
    tx,
    tenantId,
    'calendar.shift.closed',
    {
      tenantId,
      locationId: shift.branchId,
      businessDayId: shift.businessDayId,
      businessDate: shift.newDay,
      shiftInstanceId: shift.id,
      closedByUserId: userId,
    },
    `calendar.shift.closed:${shift.id}`,
  );

  return shift;
}
