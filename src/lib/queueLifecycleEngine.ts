/**
 * queueLifecycleEngine.ts — Unified queue ticket lifecycle & effective status
 *
 * Core rule: A ticket must NOT block future customers after its expected service
 * window has ended. This engine computes `effectiveStatus` for every ticket
 * and determines whether it still counts as "people ahead."
 *
 * Used by:
 *   - GET /api/queue
 *   - PATCH /api/queue/:id
 *   - POST /api/queue
 *   - POST /api/queue/estimate
 *   - GET /api/operations/flow-board
 *   - Booking availability endpoints
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type TicketStatus =
  | 'waiting'
  | 'called'
  | 'arrived'
  | 'in_service'
  | 'done'
  | 'skipped'
  | 'cancelled'
  | 'no_show';

export type EffectiveStatus =
  | TicketStatus
  | 'expired_candidate'    // waiting/called/arrived past ExpectedEndAt + grace
  | 'no_show_candidate'    // waiting/called past ExpectedEndAt + grace
  | 'overdue_finish_required' // in_service past ExpectedEndAt (needs operator action)
  ;

export interface QueueTicketRaw {
  QueueTicketID: number;
  TicketCode: string;
  TicketNumber: number;
  Status: TicketStatus;
  EmpID: number | null;
  ClientID: number | null;
  QueueDate: string;
  CreatedTime: string | Date | null;
  CalledAt: string | Date | null;
  ArrivedAt: string | Date | null;
  ServiceStartedAt: string | Date | null;
  ServiceEndedAt: string | Date | null;
  CancelledAt?: string | Date | null;
  // Expected time fields
  EstimatedStartTime: string | Date | null;
  ExpectedStartAt?: string | Date | null;
  ExpectedEndAt?: string | Date | null;
  DurationMinutes?: number | null;
  EstimatedWaitMinutes?: number | null;
  // Auto-close
  AutoClosedAt?: string | Date | null;
  AutoCloseReason?: string | null;
  LastStatusChangedAt?: string | Date | null;
  // Extra joined fields
  ClientName?: string | null;
  ClientMobile?: string | null;
  EmpName?: string | null;
  BookingID?: number | null;
  Priority?: number;
  Source?: string;
  Notes?: string | null;
}

export interface EffectiveTicket extends QueueTicketRaw {
  /** The actual DB status */
  actualStatus: TicketStatus;
  /** Computed effective status considering time expiry */
  effectiveStatus: EffectiveStatus;
  /** Computed expected start (from ExpectedStartAt or EstimatedStartTime) */
  expectedStartAt: Date | null;
  /** Computed expected end (start + duration) */
  expectedEndAt: Date | null;
  /** Duration in minutes */
  durationMinutes: number;
  /** Whether this ticket currently blocks barber availability */
  isBlockingAvailability: boolean;
  /** Whether this ticket counts in "people ahead" for new customers */
  isCountingAhead: boolean;
  /** Whether this ticket needs operator action (overdue/expired) */
  needsOperatorAction: boolean;
  /** Minutes past expected end (0 if not overdue) */
  overdueMinutes: number;
}

// ── Configuration ────────────────────────────────────────────────────────────

export interface LifecycleConfig {
  /** Grace period in minutes after ExpectedEndAt before declaring expired/overdue */
  graceMinutes: number;
  /** Default service duration if not specified */
  defaultDurationMinutes: number;
}

const DEFAULT_CONFIG: LifecycleConfig = {
  graceMinutes: 15,
  defaultDurationMinutes: 30,
};

// ── Closed statuses (terminal — never block) ────────────────────────────────

const CLOSED_STATUSES: Set<TicketStatus> = new Set([
  'done', 'cancelled', 'no_show',
]);

// ── Core computation ─────────────────────────────────────────────────────────

/**
 * Compute effective status and derived fields for a single queue ticket.
 */
export function computeEffectiveTicket(
  raw: QueueTicketRaw,
  now: Date,
  config: LifecycleConfig = DEFAULT_CONFIG,
): EffectiveTicket {
  const actualStatus = raw.Status;
  const duration = Math.max(1, Number(raw.DurationMinutes) || config.defaultDurationMinutes);

  // Compute expected start
  const expectedStartAt = toDate(raw.ExpectedStartAt) ?? toDate(raw.EstimatedStartTime) ?? null;

  // Compute expected end
  let expectedEndAt: Date | null = null;
  if (toDate(raw.ExpectedEndAt)) {
    expectedEndAt = toDate(raw.ExpectedEndAt);
  } else if (expectedStartAt) {
    expectedEndAt = new Date(expectedStartAt.getTime() + duration * 60_000);
  }

  // For in_service, use ServiceStartedAt + duration if no explicit ExpectedEndAt
  if (actualStatus === 'in_service' && !expectedEndAt && raw.ServiceStartedAt) {
    const started = toDate(raw.ServiceStartedAt);
    if (started) {
      expectedEndAt = new Date(started.getTime() + duration * 60_000);
    }
  }

  // Determine overdue
  const graceMs = config.graceMinutes * 60_000;
  let overdueMinutes = 0;
  if (expectedEndAt) {
    const elapsed = now.getTime() - expectedEndAt.getTime();
    if (elapsed > 0) {
      overdueMinutes = Math.floor(elapsed / 60_000);
    }
  }

  // Compute effective status
  let effectiveStatus: EffectiveStatus = actualStatus;
  let isBlockingAvailability = false;
  let isCountingAhead = false;
  let needsOperatorAction = false;

  if (CLOSED_STATUSES.has(actualStatus)) {
    // Terminal — no effect
    effectiveStatus = actualStatus;
    isBlockingAvailability = false;
    isCountingAhead = false;
    needsOperatorAction = false;
  } else if (actualStatus === 'in_service') {
    if (expectedEndAt && now.getTime() > expectedEndAt.getTime() + graceMs) {
      // Overdue: past expected end + grace
      effectiveStatus = 'overdue_finish_required';
      isBlockingAvailability = false; // don't block new availability
      isCountingAhead = false;        // don't count as "ahead"
      needsOperatorAction = true;     // operator must finish/extend/cancel
    } else {
      // Active in_service within time
      effectiveStatus = 'in_service';
      isBlockingAvailability = true;
      isCountingAhead = true;
      needsOperatorAction = false;
    }
  } else if (actualStatus === 'waiting' || actualStatus === 'called' || actualStatus === 'arrived') {
    if (expectedEndAt && now.getTime() > expectedEndAt.getTime() + graceMs) {
      // Expired: their window has fully passed
      if (actualStatus === 'arrived') {
        effectiveStatus = 'expired_candidate';
      } else {
        effectiveStatus = 'no_show_candidate';
      }
      isBlockingAvailability = false;
      isCountingAhead = false;
      needsOperatorAction = true;
    } else if (expectedEndAt && now.getTime() > expectedEndAt.getTime()) {
      // Past expected end but within grace — still somewhat blocking
      effectiveStatus = actualStatus;
      isBlockingAvailability = false; // don't block availability slots
      isCountingAhead = false;        // don't count as "ahead"
      needsOperatorAction = true;
    } else {
      // Active within expected window
      effectiveStatus = actualStatus;
      isBlockingAvailability = true;
      isCountingAhead = true;
      needsOperatorAction = false;
    }
  } else if (actualStatus === 'skipped') {
    // Skipped doesn't block or count
    effectiveStatus = 'skipped';
    isBlockingAvailability = false;
    isCountingAhead = false;
    needsOperatorAction = false;
  }

  return {
    ...raw,
    actualStatus,
    effectiveStatus,
    expectedStartAt,
    expectedEndAt,
    durationMinutes: duration,
    isBlockingAvailability,
    isCountingAhead,
    needsOperatorAction,
    overdueMinutes,
  };
}

/**
 * Process a batch of raw tickets and compute effective status for all.
 */
export function computeEffectiveTickets(
  tickets: QueueTicketRaw[],
  now: Date,
  config: LifecycleConfig = DEFAULT_CONFIG,
): EffectiveTicket[] {
  return tickets.map(t => computeEffectiveTicket(t, now, config));
}

// ── Filtering helpers ────────────────────────────────────────────────────────

/**
 * Get only tickets that count as "people ahead" for a new customer.
 */
export function getCountingAheadTickets(
  tickets: EffectiveTicket[],
  barberId?: number,
): EffectiveTicket[] {
  return tickets.filter(t => {
    if (!t.isCountingAhead) return false;
    if (barberId != null && t.EmpID !== barberId) return false;
    return true;
  });
}

/**
 * Get tickets that are actively blocking availability (for estimate engine).
 */
export function getBlockingTickets(
  tickets: EffectiveTicket[],
  barberId?: number,
): EffectiveTicket[] {
  return tickets.filter(t => {
    if (!t.isBlockingAvailability) return false;
    if (barberId != null && t.EmpID !== barberId) return false;
    return true;
  });
}

/**
 * Get tickets that need operator action (overdue, expired, no-show candidates).
 */
export function getActionRequiredTickets(
  tickets: EffectiveTicket[],
): EffectiveTicket[] {
  return tickets.filter(t => t.needsOperatorAction);
}

/**
 * Get active effective tickets (not closed, not skipped).
 */
export function getActiveEffectiveTickets(
  tickets: EffectiveTicket[],
): EffectiveTicket[] {
  return tickets.filter(t =>
    !CLOSED_STATUSES.has(t.actualStatus) && t.actualStatus !== 'skipped'
  );
}

/**
 * Compute "people ahead" count for a specific barber.
 * Only counts tickets where effectiveStatus is active AND isCountingAhead.
 */
export function computePeopleAhead(
  tickets: EffectiveTicket[],
  barberId: number,
  now: Date,
): number {
  return tickets.filter(t => {
    if (t.EmpID !== barberId) return false;
    if (!t.isCountingAhead) return false;
    // Extra safety: expectedEndAt must be > now
    if (t.expectedEndAt && t.expectedEndAt.getTime() <= now.getTime()) return false;
    return true;
  }).length;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
