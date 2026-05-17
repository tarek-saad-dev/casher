// Shared TypeScript types for the Operations Board

export interface BarberStatus {
  EmpID:              number;
  EmpName:            string;
  Job:                string | null;
  IsAvailable:        boolean;
  AvailabilityReason: string;
  WorkingStartTime:   string | null;
  WorkingEndTime:     string | null;
  // Enriched by overview API
  currentTicket?: QueueTicket | null;
  nextTicket?:    QueueTicket | null;
  nextBooking?:   Booking     | null;
}

export interface QueueTicket {
  QueueTicketID:         number;
  TicketCode:            string;
  TicketNumber:          number;
  EmpID:                 number | null;
  ClientID:              number | null;
  QueueDate:             string;
  CreatedTime:           string;
  Status:                QueueStatus;
  Priority:              number;
  Notes:                 string | null;
  CalledAt:              string | null;
  ArrivedAt:             string | null;
  ServiceStartedAt:      string | null;
  ServiceEndedAt:        string | null;
  CancelledAt:           string | null;
  EstimatedStartTime:    string | null;
  EstimatedWaitMinutes:  number | null;
  WaitingCountAtCreation: number | null;
  ClientName:            string | null;
  ClientMobile:          string | null;
  EmpName:               string | null;
  services?:             QueueService[];
}

export type QueueStatus =
  | 'waiting' | 'called' | 'arrived' | 'in_service' | 'done' | 'skipped' | 'cancelled';

export interface QueueService {
  ProID:           number | null;
  ProName:         string | null;
  Qty:             number;
  DurationMinutes: number | null;
  Price:           number | null;
}

export interface Booking {
  BookingID:       number;
  ClientID:        number | null;
  AssignedEmpID:   number | null;
  BookingDate:     string;
  StartTime:       string;
  EndTime:         string | null;
  Status:          BookingStatus;
  Source:          string;
  Notes:           string | null;
  QueueTicketID:   number | null;
  CreatedAt:       string;
  CancelledAt:     string | null;
  CancelReason:    string | null;
  ClientName:      string | null;
  ClientMobile:    string | null;
  EmpName:         string | null;
  ServiceCount:    number;
}

export type BookingStatus =
  | 'pending' | 'confirmed' | 'arrived' | 'queued' | 'in_service' | 'done'
  | 'cancelled' | 'no_show' | 'rescheduled';

export interface OperationAlert {
  id:          string;
  type:        string;
  severity:    'info' | 'warning' | 'danger';
  message:     string;
  relatedId:   number | null;
  relatedType: 'booking' | 'ticket' | 'barber' | null;
  action:      string | null;
  actionLabel: string | null;
}

export interface OverviewData {
  date:                  string;
  shift:                 string;
  availableBarbersCount: number;
  waitingQueueCount:     number;
  upcomingBookingsCount: number;
  averageWaitMinutes:    number;
  alertsCount:           number;
  barbers:               BarberStatus[];
  queueTickets:          QueueTicket[];
  bookings:              Booking[];
}

export interface EstimateResult {
  empId:                number;
  empName:              string;
  available?:           boolean;
  isFreeNow?:           boolean;
  statusText?:          string;
  estimatedStartTime:   string;
  estimatedWaitMinutes: number;
  waitingCount:         number;
  activeQueueCount?:    number;
  contextMsg?:          string;
  blockingQueueCount?:  number;
  blockingBookingCount?: number;
  blockingQueueTickets?: Array<{ id: number; estimatedStart: string; durationMin: number }>;
  blockingBookings?:    Array<{ id: number; start: string; end: string }>;
  blockingTickets?:     Array<{ ticketCode: string; status: string; estimatedStart: string }>;
}

export interface EstimateResponse {
  ok:                   boolean;
  best:                 EstimateResult | null;
  alternatives:         EstimateResult[];
  unavailable:          Array<{ empId: number; empName: string; reason: string }>;
  /** Returned by specific mode when barber is unavailable */
  unavailableReason:    string | undefined;
  /** Human-readable summary message */
  message:              string | undefined;
  /** Context explanation for estimate panel */
  contextMsg?:          string;
  blockingQueueCount?:  number;
  blockingBookingCount?: number;
}

export interface BookingBarberResult {
  empId:               number;
  empName:             string;
  available:           boolean;
  statusText:          string;
  reason:              string | null;
  conflictType:        'working_hours' | 'day_off' | 'queue' | 'booking' | null;
  workingWindow:       string | null;
  nextAvailableTime:   string | null;
  startTime:           string;
  endTime:             string;
  durationMinutes:     number;
  conflictingTickets:  Array<{ ticketCode: string; status: string; start: string; end: string }>;
  conflictingBookings: Array<{ bookingId: number; start: string; end: string }>;
}

export interface BookingEstimateResponse {
  ok:           boolean;
  barbers:      BookingBarberResult[];
  best:         BookingBarberResult | null;
  alternatives: BookingBarberResult[];
  unavailable:  BookingBarberResult[];
}

// Status label/color helpers
export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  waiting:    'منتظر',
  called:     'تم النداء',
  arrived:    'وصل',
  in_service: 'داخل الخدمة',
  done:       'تم',
  skipped:    'تم التخطي',
  cancelled:  'ملغي',
};

export const QUEUE_STATUS_COLORS: Record<QueueStatus, string> = {
  waiting:    '#F59E0B',
  called:     '#3B82F6',
  arrived:    '#8B5CF6',
  in_service: '#10B981',
  done:       '#6B7280',
  skipped:    '#EF4444',
  cancelled:  '#374151',
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending:     'معلق',
  confirmed:   'مؤكد',
  arrived:     'وصل',
  queued:      'في الدور',
  in_service:  'داخل الخدمة',
  done:        'تم',
  cancelled:   'ملغي',
  no_show:     'لم يحضر',
  rescheduled: 'أُعيد جدولته',
};

export const BOOKING_STATUS_COLORS: Record<BookingStatus, string> = {
  pending:     '#F59E0B',
  confirmed:   '#3B82F6',
  arrived:     '#8B5CF6',
  queued:      '#06B6D4',
  in_service:  '#10B981',
  done:        '#6B7280',
  cancelled:   '#374151',
  no_show:     '#EF4444',
  rescheduled: '#F97316',
};
