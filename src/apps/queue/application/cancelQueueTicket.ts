import 'server-only';
import {
  cancelQueueTicketCore,
  type CancelQueueTicketInput,
  type CancelQueueTicketResult,
} from '@/lib/queueCancelCore';
import type { QueuePortHooks } from '@/apps/queue/internal/queuePortAdapter';

export type CancelQueueTicketCommand = CancelQueueTicketInput & {
  tenantId: string;
  queuePortHooks: QueuePortHooks;
};

export async function cancelQueueTicket(
  input: CancelQueueTicketCommand,
): Promise<CancelQueueTicketResult> {
  return cancelQueueTicketCore({
    ...input,
    queuePortHooks: input.queuePortHooks,
    useExtractedEventDelivery: true,
  });
}
