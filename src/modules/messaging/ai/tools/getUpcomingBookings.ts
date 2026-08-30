import 'server-only';
import { listPublicUpcomingBookings } from '@/lib/booking/publicBookingReader';
import { isBookingManagementActiveForPhone } from '../bookingManagement/featureFlag';
import { summarizePublicBooking } from '../bookingManagement/responseCopy';
import type { AiToolCallRequest, AiToolExecutionContext, AiToolResult } from './types';

export async function executeGetUpcomingBookings(
  _request: AiToolCallRequest,
  ctx: AiToolExecutionContext,
): Promise<Omit<AiToolResult, 'durationMs'>> {
  const phone = String(ctx.phone || '').trim();
  const input = { phoneSuffix: phone.slice(-4) };

  if (!isBookingManagementActiveForPhone(phone)) {
    return {
      name: 'get_upcoming_bookings',
      ok: true,
      input,
      data: { bookings: [], count: 0, hasMore: false, featureDisabled: true },
    };
  }

  if (!phone) {
    return {
      name: 'get_upcoming_bookings',
      ok: false,
      input,
      errorCode: 'PHONE_REQUIRED',
      errorMessage: 'Conversation phone missing',
    };
  }

  try {
    const result = await listPublicUpcomingBookings({ phone, limit: 10 });
    const bookings = result.bookings.map((dto) => summarizePublicBooking(dto, null));
    return {
      name: 'get_upcoming_bookings',
      ok: true,
      input,
      data: {
        bookings,
        count: result.meta.count,
        hasMore: result.meta.hasMore,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: 'get_upcoming_bookings',
      ok: false,
      input,
      errorCode: message.includes('INVALID') ? 'INVALID_PHONE' : 'UPCOMING_UNAVAILABLE',
      errorMessage: 'مش قادر أتأكد من الحجوزات دلوقتي. ممكن نجرب تاني بعد شوية.',
    };
  }
}
