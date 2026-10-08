import 'server-only';
import {
  createPublicBooking,
  type PublicBookingCreateInput,
  type PublicBookingCreateResult,
} from '@/lib/booking/publicBookingCreate';
import type { SchedulingPortHooks } from '@/apps/booking/internal/schedulingPortAdapter';
import { namespacedHoldKey } from './holdBooking';
import { namespacedRequestKey } from './tenantRequestKey';

export type CreateBookingInput = PublicBookingCreateInput & {
  tenantId: string;
  schedulingPortHooks: SchedulingPortHooks;
};

export async function createBooking(
  input: CreateBookingInput,
): Promise<PublicBookingCreateResult> {
  const holdKey =
    typeof input.holdKey === 'string' && input.holdKey.trim()
      ? namespacedHoldKey(input.tenantId, input.holdKey)
      : input.holdKey;

  return createPublicBooking({
    ...input,
    holdKey,
    clientRequestId: namespacedRequestKey(input.tenantId, input.clientRequestId),
    idempotencyKeyHeader: namespacedRequestKey(input.tenantId, input.idempotencyKeyHeader),
    schedulingPortHooks: input.schedulingPortHooks,
    useExtractedEventDelivery: true,
    suppressNotification: true,
  });
}
