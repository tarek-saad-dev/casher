import 'server-only';
import {
  createOperationsQueueTicket,
  type CreateOperationsQueueInput,
} from '@/lib/operationsQueueCreateCore';
import type { CreateQueueResponse } from '@/lib/operationsQueueTypes';
import type { QueuePortHooks } from '@/apps/queue/internal/queuePortAdapter';

export type CreateQueueTicketInput = CreateOperationsQueueInput & {
  tenantId: string;
  queuePortHooks: QueuePortHooks;
};

export async function createQueueTicket(
  input: CreateQueueTicketInput,
): Promise<CreateQueueResponse> {
  return createOperationsQueueTicket({
    ...input,
    queuePortHooks: input.queuePortHooks,
    useExtractedEventDelivery: true,
  });
}
