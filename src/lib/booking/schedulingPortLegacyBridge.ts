import 'server-only';
import type { Transaction } from 'mssql';
import type { SchedulingPortHooks } from '@/apps/booking/internal/schedulingPortAdapter';
import { upsertCustomer } from '@/lib/publicBookingHelpers';
import { resolveLegacyBranchTenantId } from '@/platform/masterData/tenantScope';
import {
  assertEmployeeIntervalAvailable,
  ScheduleConflictError,
} from '@/lib/scheduleIntegrity';
import {
  acquireBookingAppLock,
  empIntervalLockResource,
  anyBarberAssignmentLockResource,
  BookingCreateLockError,
} from '@/lib/booking/publicBookingCreateLocks';

export type SchedulingPortBridgeContext = {
  schedulingPortHooks?: SchedulingPortHooks;
};

export async function bridgeUpsertCustomer(
  ctx: SchedulingPortBridgeContext,
  tx: Transaction,
  customerName: string,
  customerPhone: string,
  branchId: number,
): Promise<number> {
  if (ctx.schedulingPortHooks) {
    return ctx.schedulingPortHooks.upsertCustomer(tx, {
      phone: customerPhone,
      displayName: customerName,
    });
  }
  const tenantId = await resolveLegacyBranchTenantId(branchId, tx);
  return upsertCustomer(customerName, customerPhone, tx, tenantId);
}

function rethrowWorkforceLockTimeout(err: unknown): never {
  if (err instanceof Error && err.message === 'WORKFORCE_OCCUPANCY_LOCK_TIMEOUT') {
    throw new BookingCreateLockError('BOOKING_LOCK_TIMEOUT');
  }
  throw err;
}

export async function bridgeAcquireEmpIntervalLock(
  ctx: SchedulingPortBridgeContext,
  tx: Transaction,
  employeeId: number,
  startMs: number,
  endMs: number,
): Promise<void> {
  if (ctx.schedulingPortHooks) {
    try {
      await ctx.schedulingPortHooks.acquireEmpIntervalLock(tx, employeeId, startMs, endMs);
    } catch (err) {
      rethrowWorkforceLockTimeout(err);
    }
    return;
  }
  await acquireBookingAppLock(tx, empIntervalLockResource(employeeId, startMs, endMs));
}

export async function bridgeAcquireAnyBarberLock(
  ctx: SchedulingPortBridgeContext,
  tx: Transaction,
  locationId: number,
  startMs: number,
  endMs: number,
  slotKey: string,
): Promise<void> {
  if (ctx.schedulingPortHooks) {
    try {
      await ctx.schedulingPortHooks.acquireAnyBarberLock(tx, locationId, startMs, endMs, slotKey);
    } catch (err) {
      rethrowWorkforceLockTimeout(err);
    }
    return;
  }
  await acquireBookingAppLock(
    tx,
    anyBarberAssignmentLockResource(locationId, startMs, endMs, slotKey),
  );
}

export async function bridgeAssertEmployeeFree(
  ctx: SchedulingPortBridgeContext,
  tx: Transaction,
  input: {
    employeeId: number;
    startMs: number;
    endMs: number;
    operationalDate?: string;
    branchId?: number;
    excludeBookingId?: number;
    excludeHoldKey?: string | null;
  },
): Promise<void> {
  if (ctx.schedulingPortHooks) {
    const excludeRefs: string[] = [];
    if (input.excludeBookingId != null) {
      excludeRefs.push(`booking:${input.excludeBookingId}`);
    }
    try {
      await ctx.schedulingPortHooks.assertEmployeeFree(tx, {
        employeeId: input.employeeId,
        startMs: input.startMs,
        endMs: input.endMs,
        operationalDate: input.operationalDate,
        branchId: input.branchId,
        excludeRefs,
        excludeHoldKey: input.excludeHoldKey ?? null,
      });
    } catch (err) {
      rethrowWorkforceLockTimeout(err);
    }
    return;
  }

  await assertEmployeeIntervalAvailable({
    empId: input.employeeId,
    startAt: new Date(input.startMs),
    endAt: new Date(input.endMs),
    operationalDate: input.operationalDate,
    branchId: input.branchId,
    excludeBookingId: input.excludeBookingId,
    excludeHoldKey: input.excludeHoldKey ?? null,
    transaction: tx,
  });
}

export async function bridgePublishCreatedEvent(
  ctx: SchedulingPortBridgeContext,
  tx: Transaction,
  input: {
    bookingId: number;
    bookingCode: string;
    idempotencyKey?: string | null;
  },
): Promise<void> {
  if (!ctx.schedulingPortHooks) return;
  await ctx.schedulingPortHooks.publishSchedulingEvent(tx, {
    eventType: 'booking.created',
    bookingId: input.bookingId,
    bookingCode: input.bookingCode,
    payload: {},
    idempotencyKey: input.idempotencyKey?.trim() || `booking.created:${input.bookingId}`,
  });
}

export async function bridgePublishCancelledEvent(
  ctx: SchedulingPortBridgeContext,
  tx: Transaction,
  input: {
    bookingId: number;
    bookingCode: string;
    idempotencyKey?: string | null;
  },
): Promise<void> {
  if (!ctx.schedulingPortHooks) return;
  await ctx.schedulingPortHooks.publishSchedulingEvent(tx, {
    eventType: 'booking.cancelled',
    bookingId: input.bookingId,
    bookingCode: input.bookingCode,
    payload: {},
    idempotencyKey: input.idempotencyKey?.trim() || `booking.cancelled:${input.bookingId}`,
  });
}

export async function bridgePublishRescheduledEvent(
  ctx: SchedulingPortBridgeContext,
  tx: Transaction,
  input: {
    bookingId: number;
    bookingCode?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<void> {
  if (!ctx.schedulingPortHooks) return;
  await ctx.schedulingPortHooks.publishSchedulingEvent(tx, {
    eventType: 'booking.rescheduled',
    bookingId: input.bookingId,
    bookingCode: input.bookingCode,
    payload: {},
    idempotencyKey: input.idempotencyKey?.trim() || `booking.rescheduled:${input.bookingId}`,
  });
}

export async function bridgeCommitOccupancy(
  ctx: SchedulingPortBridgeContext,
  tx: Transaction,
  input: {
    employeeId: number;
    startMs: number;
    endMs: number;
    bookingId: number;
    locationId: number;
  },
): Promise<void> {
  if (!ctx.schedulingPortHooks) return;
  await ctx.schedulingPortHooks.commitOccupancy(tx, {
    employeeId: input.employeeId,
    startMs: input.startMs,
    endMs: input.endMs,
    ref: `booking:${input.bookingId}`,
    locationId: input.locationId,
  });
}

export { ScheduleConflictError, BookingCreateLockError };
