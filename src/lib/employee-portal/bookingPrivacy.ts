export type PortalHandoffBadge = 'none' | 'pending' | 'charged';

export type MaskedPortalBooking = {
  bookingId: number;
  startTime: string;
  endTime: string;
  status: string;
  firstName: string;
  serviceNames: string[];
  branchName: string | null;
  /** Optional cashier handoff badge — never includes PII beyond first name. */
  handoffStatus: PortalHandoffBadge;
  /** Arrival/service lifecycle remains separate from paid booking status. */
  staffPhase: 'scheduled' | 'arrived' | 'in_service' | 'finished';
};

/** Cairo calendar date as YYYY-MM-DD. */
export function cairoTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** First whitespace token only — never expose full customer identity. */
export function maskClientFirstName(fullName: string | null | undefined): string {
  const trimmed = String(fullName ?? '').trim();
  if (!trimmed) return 'عميل';
  const first = trimmed.split(/\s+/)[0]?.trim();
  return first || 'عميل';
}
