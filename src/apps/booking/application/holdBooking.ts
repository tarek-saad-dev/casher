import 'server-only';
import {
  createBookingHold,
  releaseBookingHold,
  type BookingHoldRecord,
} from '@/lib/booking/bookingHold';
import { tenantLockResource } from '@/platform/public';

export type HoldBookingInput = {
  tenantId: string;
  branchId: number;
  empId: number;
  businessDate: string;
  startAt: Date;
  endAt: Date;
  holdKey: string;
  sessionKey?: string | null;
  clientRequestId?: string | null;
  ttlMs?: number;
};

export function namespacedHoldKey(tenantId: string, holdKey: string): string {
  const base = holdKey.trim();
  const tenant = String(tenantId ?? '').trim().toLowerCase();
  if (!tenant) throw new Error('namespacedHoldKey requires an authoritative tenantId');
  const prefix = `t:${tenant}:`;
  return base.toLowerCase().startsWith(prefix)
    ? `${prefix}${base.slice(prefix.length)}`
    : `${prefix}${base}`;
}

export async function holdBooking(input: HoldBookingInput): Promise<BookingHoldRecord> {
  return createBookingHold({
    ...input,
    holdKey: namespacedHoldKey(input.tenantId, input.holdKey),
  });
}

export async function releaseHoldBooking(
  tenantId: string,
  holdKey: string,
): Promise<void> {
  await releaseBookingHold(namespacedHoldKey(tenantId, holdKey));
}

export { tenantLockResource };
