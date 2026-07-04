import { NextResponse } from 'next/server';
import { executeQuickQueueOperation } from '@/lib/operationsQueueCreateCore';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const result = await executeQuickQueueOperation();

    if (!('ticketCode' in result)) {
      const status =
        result.reason === 'quick_queue_disabled' || result.reason === 'service_unavailable'
          ? 503
          : result.reason === 'no_available_barber' ||
              result.reason === 'barber_unavailable' ||
              result.reason === 'simulation_failed' ||
              result.reason === 'schedule_conflict'
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
