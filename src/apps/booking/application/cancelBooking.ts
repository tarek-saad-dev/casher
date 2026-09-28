import 'server-only';
import {
  cancelPublicBooking,
  type CancelPublicBookingInput,
  type CancelPublicBookingResult,
} from '@/lib/booking/publicBookingCancellation';
import type { SchedulingPortHooks } from '@/apps/booking/internal/schedulingPortAdapter';

export type CancelBookingInput = CancelPublicBookingInput & {
  schedulingPortHooks: SchedulingPortHooks;
};

export async function cancelBooking(
  input: CancelBookingInput,
): Promise<CancelPublicBookingResult> {
  return cancelPublicBooking({
    ...input,
    schedulingPortHooks: input.schedulingPortHooks,
    useExtractedEventDelivery: true,
  });
}
