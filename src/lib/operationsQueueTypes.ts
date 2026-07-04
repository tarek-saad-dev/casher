/**
 * Shared queue API types — client-safe (no server/database imports).
 */

export interface CreateQueueRequest {
  empId: number;
  serviceIds: number[];
  customer?: {
    clientId?: number;
    name?: string;
    phone?: string;
  };
  expectedStartTime: string;
  expectedEndTime: string;
  source: 'walk_in' | 'booking' | 'reschedule';
}

export interface CreateQueueResponse {
  ok: true;
  ticketCode: string;
  ticketNumber: number;
  ticketPrefix: string;
  queueTicketId: number;
  queueDate: string;
  empId: number;
  empName: string;
  chairNumber: number | null;
  customer: {
    clientId: number | null;
    name: string | null;
    phone: string | null;
  };
  services: Array<{
    proId: number;
    proName: string;
    durationMinutes: number;
    price?: number;
  }>;
  serviceDurationMinutes: number;
  estimatedStartTime: string;
  estimatedEndTime: string;
  estimatedWaitMinutes: number;
  peopleBefore: number;
  waitingCountAtCreation: number;
  status: string;
  createdAt: string;
}
