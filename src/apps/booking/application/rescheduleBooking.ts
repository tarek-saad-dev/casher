import 'server-only';
import {
  reschedulePublicBooking,
  type ReschedulePublicBookingInput,
  type ReschedulePublicBookingResult,
} from '@/lib/booking/publicBookingReschedule';
import {
  rescheduleBookingMove,
  type LoadedBookingForReschedule,
} from '@/lib/bookingRescheduleCore';
import type { SchedulingPortHooks } from '@/apps/booking/internal/schedulingPortAdapter';

export type ReschedulePublicBookingCommandInput = ReschedulePublicBookingInput & {
  schedulingPortHooks: SchedulingPortHooks;
};

export async function reschedulePublicBookingCommand(
  input: ReschedulePublicBookingCommandInput,
): Promise<ReschedulePublicBookingResult> {
  return reschedulePublicBooking({
    ...input,
    schedulingPortHooks: input.schedulingPortHooks,
    useExtractedEventDelivery: true,
  });
}

export type RescheduleOpsBookingInput = {
  bookingId: number;
  newStartAt: string;
  operationalDate: string;
  source: string;
  userId: number;
  targetEmpId?: number;
  targetBranchId?: number | null;
  skipCustomerWhatsApp?: boolean;
  schedulingPortHooks: SchedulingPortHooks;
};

export async function rescheduleOpsBooking(
  input: RescheduleOpsBookingInput,
): Promise<{
  bookingId: number;
  oldStartAt: string;
  oldEndAt: string;
  oldEmpId: number;
  oldEmpName: string | null;
  newStartAt: string;
  newEndAt: string;
  newEmpId: number;
  newEmpName: string | null;
  durationMinutes: number;
  customerName: string | null;
}> {
  return rescheduleBookingMove({
    ...input,
    schedulingPortHooks: input.schedulingPortHooks,
    useExtractedEventDelivery: true,
    skipCustomerWhatsApp: true,
  });
}

export type { LoadedBookingForReschedule };
