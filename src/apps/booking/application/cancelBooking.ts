import 'server-only';
import {
  cancelPublicBooking,
  type CancelPublicBookingInput,
  type CancelPublicBookingResult,
} from '@/lib/booking/publicBookingCancellation';
import type { SchedulingPortHooks } from '@/apps/booking/internal/schedulingPortAdapter';
import { namespacedRequestKey } from './tenantRequestKey';

export type CancelBookingInput = CancelPublicBookingInput & {
  /** Authoritative tenant derived from the booking's own branch. */
  tenantId: string;
  schedulingPortHooks: SchedulingPortHooks;
};

export async function cancelBooking(
  input: CancelBookingInput,
): Promise<CancelPublicBookingResult> {
  return cancelPublicBooking({
    ...input,
    clientRequestId: namespacedRequestKey(input.tenantId, input.clientRequestId),
    idempotencyKey: namespacedRequestKey(input.tenantId, input.idempotencyKey),
    schedulingPortHooks: input.schedulingPortHooks,
    useExtractedEventDelivery: true,
  });
}
