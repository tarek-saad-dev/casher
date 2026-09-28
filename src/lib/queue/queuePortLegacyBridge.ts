import 'server-only';
import type { Transaction } from 'mssql';
import type { QueuePortHooks } from '@/apps/queue/internal/queuePortAdapter';
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

export type QueuePortBridgeContext = {
  queuePortHooks?: QueuePortHooks;
};

function rethrowWorkforceLockTimeout(err: unknown): never {
  if (err instanceof Error && err.message === 'WORKFORCE_OCCUPANCY_LOCK_TIMEOUT') {
    throw new BookingCreateLockError('BOOKING_LOCK_TIMEOUT');
  }
  throw err;
}

export async function bridgeQueueAssertEmployeeFree(
  ctx: QueuePortBridgeContext,
  tx: Transaction,
  input: {
    employeeId: number;
    startMs: number;
    endMs: number;
    operationalDate?: string;
    branchId?: number;
    excludeQueueTicketId?: number;
    excludeBookingId?: number;
    excludeHoldKey?: string | null;
  },
): Promise<void> {
  if (ctx.queuePortHooks) {
    const excludeRefs: string[] = [];
    if (input.excludeBookingId != null) {
      excludeRefs.push(`booking:${input.excludeBookingId}`);
    }
    if (input.excludeQueueTicketId != null) {
      excludeRefs.push(`queue:${input.excludeQueueTicketId}`);
    }
    try {
      await ctx.queuePortHooks.assertEmployeeFree(tx, {
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
    excludeQueueTicketId: input.excludeQueueTicketId,
    excludeHoldKey: input.excludeHoldKey ?? null,
    transaction: tx,
  });
}

export async function bridgeQueueAcquireAnyBarberLock(
  ctx: QueuePortBridgeContext,
  tx: Transaction,
  locationId: number,
  startMs: number,
  endMs: number,
  slotKey: string,
): Promise<void> {
  if (ctx.queuePortHooks) {
    try {
      await ctx.queuePortHooks.acquireAnyBarberLock(tx, locationId, startMs, endMs, slotKey);
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

export async function bridgeQueueUpsertCustomer(
  ctx: QueuePortBridgeContext,
  tx: Transaction,
  customerName: string,
  customerPhone: string,
): Promise<number> {
  if (ctx.queuePortHooks) {
    return ctx.queuePortHooks.upsertCustomer(tx, {
      phone: customerPhone,
      displayName: customerName,
    });
  }
  const { upsertCustomer } = await import('@/lib/publicBookingHelpers');
  return upsertCustomer(customerName, customerPhone, tx);
}

export async function bridgeQueuePublishCreatedEvent(
  ctx: QueuePortBridgeContext,
  tx: Transaction,
  input: {
    queueTicketId: number;
    ticketCode: string;
    branchId: number;
    empId: number;
    idempotencyKey?: string | null;
  },
): Promise<void> {
  if (!ctx.queuePortHooks) return;
  await ctx.queuePortHooks.publishQueueEvent(tx, {
    eventType: 'queue.created',
    queueTicketId: input.queueTicketId,
    ticketCode: input.ticketCode,
    payload: { branchId: input.branchId, empId: input.empId },
    idempotencyKey: input.idempotencyKey?.trim() || `queue.created:${input.queueTicketId}`,
  });
}

export async function bridgeQueuePublishCancelledEvent(
  ctx: QueuePortBridgeContext,
  tx: Transaction,
  input: {
    queueTicketId: number;
    ticketCode: string;
    idempotencyKey?: string | null;
  },
): Promise<void> {
  if (!ctx.queuePortHooks) return;
  await ctx.queuePortHooks.publishQueueEvent(tx, {
    eventType: 'queue.cancelled',
    queueTicketId: input.queueTicketId,
    ticketCode: input.ticketCode,
    payload: {},
    idempotencyKey: input.idempotencyKey?.trim() || `queue.cancelled:${input.queueTicketId}`,
  });
}

export async function bridgeQueuePublishTransferredEvent(
  ctx: QueuePortBridgeContext,
  tx: Transaction,
  input: {
    queueTicketId: number;
    ticketCode: string;
    fromEmpId: number;
    toEmpId: number;
    idempotencyKey?: string | null;
  },
): Promise<void> {
  if (!ctx.queuePortHooks) return;
  await ctx.queuePortHooks.publishQueueEvent(tx, {
    eventType: 'queue.transferred',
    queueTicketId: input.queueTicketId,
    ticketCode: input.ticketCode,
    payload: { fromEmpId: input.fromEmpId, toEmpId: input.toEmpId },
    idempotencyKey: input.idempotencyKey?.trim() || `queue.transferred:${input.queueTicketId}`,
  });
}

export async function bridgeQueuePublishCompletedEvent(
  ctx: QueuePortBridgeContext,
  tx: Transaction,
  input: {
    queueTicketId: number;
    ticketCode: string;
    idempotencyKey?: string | null;
  },
): Promise<void> {
  if (!ctx.queuePortHooks) return;
  await ctx.queuePortHooks.publishQueueEvent(tx, {
    eventType: 'queue.completed',
    queueTicketId: input.queueTicketId,
    ticketCode: input.ticketCode,
    payload: {},
    idempotencyKey: input.idempotencyKey?.trim() || `queue.completed:${input.queueTicketId}`,
  });
}

export async function bridgeQueueCommitOccupancy(
  ctx: QueuePortBridgeContext,
  tx: Transaction,
  input: {
    employeeId: number;
    startMs: number;
    endMs: number;
    queueTicketId: number;
    locationId: number;
  },
): Promise<void> {
  if (!ctx.queuePortHooks) return;
  await ctx.queuePortHooks.commitOccupancy(tx, {
    employeeId: input.employeeId,
    startMs: input.startMs,
    endMs: input.endMs,
    ref: `queue:${input.queueTicketId}`,
    locationId: input.locationId,
  });
}

export { ScheduleConflictError, BookingCreateLockError };
