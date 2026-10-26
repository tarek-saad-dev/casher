export const MAX_TREATMENT_SESSIONS = 50;

export class TreatmentPlanConflict extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'NOT_READY' | 'PLAN_ALREADY_EXISTS' | 'BOOKING_MISMATCH' |
      'SESSION_OCCUPIED' | 'BOOKING_ALREADY_LINKED' | 'MIGRATION_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'TreatmentPlanConflict';
  }
}

export function parseTreatmentUuid(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null;
}

export function parseTreatmentInteger(value: unknown, max: number): number | null {
  const parsed = typeof value === 'number' ? value :
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
}

export function validateTreatmentPlan(input: unknown):
  | { ok: true; title: string; totalSessions: number }
  | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { ok: false, error: 'بيانات الخطة غير صحيحة' };
  const row = input as Record<string, unknown>;
  if (typeof row.title !== 'string' || row.title.trim().length < 3 ||
      row.title.trim().length > 180)
    return { ok: false, error: 'اسم خطة العلاج لازم يكون من 3 إلى 180 حرف' };
  const totalSessions = typeof row.totalSessions === 'number' ? parseTreatmentInteger(row.totalSessions, MAX_TREATMENT_SESSIONS) : null;
  if (totalSessions === null)
    return { ok: false, error: 'عدد الجلسات من 1 إلى 50 جلسة' };
  return { ok: true, title: row.title.trim(), totalSessions };
}

export type TreatmentSessionView = {
  sessionNumber: number;
  bookingId: number | null;
  bookingStatus: string | null;
  bookingDate: string | null;
  encounterId: string | null;
  encounterStatus: string | null;
};

export type TreatmentSessionState = 'unbooked' | 'booked' | 'completed' | 'needs_rebooking';
export function treatmentSessionState(session: TreatmentSessionView): TreatmentSessionState {
  if (session.encounterStatus === 'completed') return 'completed';
  if (session.bookingId === null) return 'unbooked';
  if (['cancelled', 'canceled', 'no_show', 'rescheduled'].includes(
    String(session.bookingStatus || '').toLowerCase(),
  )) return 'needs_rebooking';
  return 'booked';
}

export function treatmentProgress(sessions: TreatmentSessionView[]) {
  const completed = sessions.filter(s => treatmentSessionState(s) === 'completed').length;
  const needsRebooking = sessions.filter(s => treatmentSessionState(s) === 'needs_rebooking').length;
  return {
    total: sessions.length, completed, remaining: sessions.length - completed,
    booked: sessions.filter(s => treatmentSessionState(s) === 'booked').length,
    needsRebooking,
    percent: sessions.length ? Math.round(completed / sessions.length * 100) : 0,
  };
}
