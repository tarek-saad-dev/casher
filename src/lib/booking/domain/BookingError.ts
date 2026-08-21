/**
 * Booking V2 — domain errors (not HTTP / Next.js response mapping).
 * Routes keep existing publicBookingErrorCatalog; map here only when migrating.
 */

export const BOOKING_DOMAIN_ERROR_CODES = [
  'INVALID_BUSINESS_DATE',
  'INVALID_CLOCK_TIME',
  'INVALID_BOOKING_INTERVAL',
  'INVALID_DURATION',
  'BRANCH_CLOSED',
  'EMPLOYEE_INACTIVE',
  'NOT_ASSIGNED_TO_BRANCH',
  'SCHEDULE_NOT_CONFIGURED',
  'EMPLOYEE_OFF_DAY',
  'EMPLOYEE_ABSENT',
  'FREELANCER_NOT_PLANNED',
  'DAY_CLOSED',
  'OUTSIDE_WORKING_WINDOW',
  'BLOCKED_BY_RANGE',
  'LATE_START_NOT_MET',
  'EARLY_LEAVE_EXCEEDED',
  'MIN_NOTICE_NOT_MET',
  'MAX_ADVANCE_EXCEEDED',
  'SERVICE_DURATION_UNRESOLVED',
  'SLOT_UNAVAILABLE',
  'MULTI_BRANCH_RESOURCE_CONFLICT',
] as const;

export type BookingDomainErrorCode = (typeof BOOKING_DOMAIN_ERROR_CODES)[number];

export type BookingDomainErrorMeta = Record<string, unknown>;

export class BookingDomainError extends Error {
  readonly code: BookingDomainErrorCode;
  readonly meta: BookingDomainErrorMeta;

  constructor(code: BookingDomainErrorCode, meta: BookingDomainErrorMeta = {}) {
    super(code);
    this.name = 'BookingDomainError';
    this.code = code;
    this.meta = meta;
  }
}

export function isBookingDomainError(err: unknown): err is BookingDomainError {
  return err instanceof BookingDomainError;
}
