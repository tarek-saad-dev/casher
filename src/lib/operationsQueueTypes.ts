/**
 * Shared queue API types — client-safe (no server/database imports).
 */

export interface QueuePlanAlternative {
  startAt: string;
  endAt: string;
  durationMinutes: number;
  label?: string;
}

export interface QueuePlanForBarberResult {
  available: boolean;
  empId?: number;
  empName?: string;
  serviceIds?: number[];
  totalDurationMinutes?: number;
  totalPrice?: number;
  expectedStartAt?: string;
  expectedEndAt?: string;
  waitingCountAtCreation?: number;
  alternatives?: QueuePlanAlternative[];
  code?: string;
  message?: string;
}

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
  source: 'walk_in' | 'booking' | 'reschedule' | 'operations_barber_header';
  /** When true, use client planned times after server validation (barber-header flow). */
  useClientPlannedTimes?: boolean;
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
