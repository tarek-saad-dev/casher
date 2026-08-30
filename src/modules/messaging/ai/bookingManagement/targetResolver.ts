import type { LastRelevantBooking, UpcomingBookingSummary } from './types';

export type TargetResolveResult =
  | { kind: 'resolved'; booking: UpcomingBookingSummary; reason: string }
  | { kind: 'clarify'; candidates: UpcomingBookingSummary[]; reason: string }
  | { kind: 'none'; reason: string };

function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function codeMatch(a: string, b: string): boolean {
  return norm(a).replace(/\s/g, '') === norm(b).replace(/\s/g, '');
}

/**
 * Resolve which upcoming booking a manage intent refers to.
 * Never guesses among multiple without clarification.
 */
export function resolveBookingTarget(input: {
  upcoming: UpcomingBookingSummary[];
  explicitCode?: string | null;
  referenceText?: string | null;
  lastRelevant?: LastRelevantBooking | null;
  pendingCandidateCodes?: string[] | null;
  ordinalOneBased?: number | null;
}): TargetResolveResult {
  const upcoming = input.upcoming.filter((b) => Boolean(b.bookingCode));
  if (upcoming.length === 0) {
    return { kind: 'none', reason: 'no_upcoming' };
  }

  const code = String(input.explicitCode ?? '').trim();
  if (code) {
    const hit = upcoming.find((b) => codeMatch(b.bookingCode, code));
    if (hit) return { kind: 'resolved', booking: hit, reason: 'explicit_code' };
    return { kind: 'none', reason: 'code_not_in_upcoming' };
  }

  if (
    input.ordinalOneBased != null &&
    Number.isFinite(input.ordinalOneBased) &&
    input.pendingCandidateCodes &&
    input.pendingCandidateCodes.length > 0
  ) {
    const idx = Math.floor(input.ordinalOneBased) - 1;
    const codeAt = input.pendingCandidateCodes[idx];
    if (codeAt) {
      const hit = upcoming.find((b) => codeMatch(b.bookingCode, codeAt));
      if (hit) return { kind: 'resolved', booking: hit, reason: 'ordinal_pending' };
    }
  }

  const ref = norm(input.referenceText);
  if (ref && input.pendingCandidateCodes && input.pendingCandidateCodes.length > 0) {
    const pending = upcoming.filter((b) =>
      input.pendingCandidateCodes!.some((c) => codeMatch(c, b.bookingCode)),
    );
    const byEmp = pending.filter(
      (b) => b.employeeName && ref.includes(norm(b.employeeName)),
    );
    if (byEmp.length === 1) {
      return { kind: 'resolved', booking: byEmp[0]!, reason: 'pending_employee_ref' };
    }
    const byDate = pending.filter(
      (b) =>
        (b.workDate && ref.includes(b.workDate)) ||
        (b.time && ref.includes(b.time)),
    );
    if (byDate.length === 1) {
      return { kind: 'resolved', booking: byDate[0]!, reason: 'pending_date_time_ref' };
    }
  }

  if (ref) {
    const byCode = upcoming.filter((b) => ref.includes(norm(b.bookingCode)));
    if (byCode.length === 1) {
      return { kind: 'resolved', booking: byCode[0]!, reason: 'text_code' };
    }
    const byEmp = upcoming.filter(
      (b) => b.employeeName && ref.includes(norm(b.employeeName)),
    );
    if (byEmp.length === 1) {
      return { kind: 'resolved', booking: byEmp[0]!, reason: 'text_employee' };
    }
    const byBranch = upcoming.filter(
      (b) =>
        (b.branchName && ref.includes(norm(b.branchName))) ||
        (b.branchCode && ref.includes(norm(b.branchCode))),
    );
    if (byBranch.length === 1) {
      return { kind: 'resolved', booking: byBranch[0]!, reason: 'text_branch' };
    }
  }

  if (input.lastRelevant?.bookingCode) {
    const hit = upcoming.find((b) =>
      codeMatch(b.bookingCode, input.lastRelevant!.bookingCode),
    );
    if (hit) {
      return { kind: 'resolved', booking: hit, reason: 'last_relevant' };
    }
  }

  if (upcoming.length === 1) {
    return { kind: 'resolved', booking: upcoming[0]!, reason: 'single_upcoming' };
  }

  return { kind: 'clarify', candidates: upcoming, reason: 'ambiguous_multiple' };
}

/** Parse simple Arabic ordinals for pending booking selection. */
export function parseBookingSelectionOrdinal(text: string): number | null {
  const t = norm(text);
  if (!t) return null;
  if (/^(الأول|الاول|اول|1|واحد)$/.test(t) || t === 'الأولى' || t === 'الاولى') return 1;
  if (/^(الثاني|التاني|2|اتنين)$/.test(t) || t.includes('التانية')) return 2;
  if (/^(الثالث|التالت|3|تلاتة)$/.test(t)) return 3;
  const m = t.match(/^(\d+)$/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 20 ? n : null;
  }
  return null;
}
