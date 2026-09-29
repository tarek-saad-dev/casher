import { NextResponse } from 'next/server';
import { executeQuickQueueOperation } from '@/lib/operationsQueueCreateCore';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { isQueueSchedulingPortEnabled } from '@/apps/queue/internal/queuePortFlag';
import { buildQueuePortHooksForActor, buildStaffActorContext } from '@/lib/queueSchedulingComposition';
import { BookingCreateLockError } from '@/lib/booking/publicBookingCreateLocks';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    let portOptions: { queuePortHooks?: Awaited<ReturnType<typeof buildQueuePortHooksForActor>>; useExtractedEventDelivery?: boolean } | undefined;
    if (isQueueSchedulingPortEnabled()) {
      const actor = await buildStaffActorContext(branch.userId);
      portOptions = {
        queuePortHooks: await buildQueuePortHooksForActor(actor),
        useExtractedEventDelivery: true,
      };
    }
    const result = await executeQuickQueueOperation(branch.branchId, portOptions);

    if (!('ticketCode' in result)) {
      const status =
        result.reason === 'quick_queue_disabled' || result.reason === 'service_unavailable'
          ? 503
          : result.reason === 'no_available_barber' ||
              result.reason === 'barber_unavailable' ||
              result.reason === 'simulation_failed' ||
              result.reason === 'schedule_conflict' ||
              result.reason === 'lock_timeout'
            ? 409
            : 400;

      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          reason: result.reason,
          nextAvailableTime: result.nextAvailableTime,
        },
        { status },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BookingCreateLockError) {
      const def = PUBLIC_BOOKING_ERROR_CATALOG[err.code];
      return NextResponse.json(
        {
          ok: false,
          error: def.messageAr,
          reason: 'lock_timeout',
        },
        { status: def.httpStatus },
      );
    }
    console.error('[operations/queue/quick]', err);
    return NextResponse.json(
      {
        ok: false,
        error: 'تعذر إنشاء الدور السريع، حاول مرة أخرى',
        reason: 'server_error',
      },
      { status: 500 },
    );
  }
}
