/**
 * Shared queue ticket normalizer — works with both PascalCase (DB rows) and
 * camelCase (API responses) field names so every consumer sees the same shape.
 */
export interface NormalizedQueueTicket {
  queueTicketId:          number;
  ticketCode:             string;
  ticketNumber:           number;
  status:                 string;
  clientId:               number | null;
  clientName:             string;
  clientPhone:            string | null;
  empId:                  number | null;
  barberName:             string;
  queueDate:              string;
  createdTime:            string;
  servicesText:           string;
  estimatedStartTime:     string | null;
  estimatedWaitMinutes:   number | null;
  waitingCountAtCreation: number | null;
  priority:               number;
  source:                 string;
  notes:                  string | null;
  // Keep raw field for anything consumers need directly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _raw: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeQueueTicket(t: any): NormalizedQueueTicket {
  return {
    queueTicketId:          t.QueueTicketID          ?? t.queueTicketId          ?? t.ID          ?? 0,
    ticketCode:             t.TicketCode             ?? t.ticketCode             ?? '',
    ticketNumber:           t.TicketNumber           ?? t.ticketNumber           ?? 0,
    status:                 String(t.Status          ?? t.status                 ?? 'waiting').toLowerCase(),
    clientId:               t.ClientID               ?? t.clientId               ?? null,
    clientName:             t.ClientName             ?? t.clientName             ?? 'عميل غير محدد',
    clientPhone:            t.ClientMobile           ?? t.clientPhone            ?? t.clientMobile ?? null,
    empId:                  t.EmpID                  ?? t.empId                  ?? null,
    barberName:             t.EmpName                ?? t.barberName             ?? t.empName      ?? '-',
    queueDate:              t.QueueDate              ?? t.queueDate              ?? '',
    createdTime:            t.CreatedTime            ?? t.createdTime            ?? '',
    servicesText:           t.ServicesText           ?? t.servicesText           ?? '-',
    estimatedStartTime:     t.EstimatedStartTime     ?? t.estimatedStartTime     ?? null,
    estimatedWaitMinutes:   t.EstimatedWaitMinutes   ?? t.estimatedWaitMinutes   ?? null,
    waitingCountAtCreation: t.WaitingCountAtCreation ?? t.waitingCountAtCreation ?? null,
    priority:               t.Priority               ?? t.priority               ?? 0,
    source:                 t.Source                 ?? t.source                 ?? 'walk_in',
    notes:                  t.Notes                  ?? t.notes                  ?? null,
    _raw: t,
  };
}

export const LIVE_STATUSES = ['waiting', 'called', 'arrived', 'in_service', 'skipped'];
export const DONE_STATUSES = ['done', 'cancelled', 'no_show'];

export const BUSINESS_DATE_CAIRO = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
