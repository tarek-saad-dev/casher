import type { CreateQueueResponse } from '@/lib/operationsQueueTypes';
import type { QueueTicketPrintData } from '@/components/queue/QueueTicketPrint';
import { normalizeCustomersAhead } from '@/lib/queueCustomersAhead';

export function createQueueResponseToPrintData(
  ticket: CreateQueueResponse,
): QueueTicketPrintData {
  const customersAhead = normalizeCustomersAhead(
    ticket.waitingCountAtCreation ?? ticket.peopleBefore,
  );

  return {
    ticketCode: ticket.ticketCode,
    clientName: ticket.customer?.name || 'عميل مباشر',
    empName: ticket.empName,
    services: ticket.services.map((s) => ({ name: s.proName })),
    queueDate: ticket.queueDate,
    createdTime: ticket.createdAt
      ? new Date(ticket.createdAt).toISOString().slice(11, 16)
      : undefined,
    waitingBefore: customersAhead,
    estimatedWaitMinutes: ticket.estimatedWaitMinutes ?? 0,
    estimatedStartTime: ticket.estimatedStartTime,
  };
}

export function formatQuickQueueSuccessToast(ticket: CreateQueueResponse): string {
  const time = new Date(ticket.estimatedStartTime).toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Africa/Cairo',
  });

  return `تم إنشاء الدور السريع ${ticket.ticketCode} مع ${ticket.empName} — الموعد المتوقع ${time}`;
}

