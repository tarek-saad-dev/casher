import { intervalsOverlap } from '@/lib/scheduleIntervals';
import type { TimelineItem } from '@/components/operations/schedulerUtils';

export type DragPreviewState = 'checking' | 'available' | 'conflict' | 'outside';

export interface LocalMoveEvaluation {
  state: DragPreviewState;
  reason?: string;
}

/** Fast advisory local validation using loaded timeline intervals */
export function evaluateLocalBookingMove(args: {
  proposedStartIso: string;
  proposedEndIso: string;
  busyItems: TimelineItem[];
  excludeBookingId: number;
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
}): LocalMoveEvaluation {
  const {
    proposedStartIso,
    proposedEndIso,
    busyItems,
    excludeBookingId,
    workStart,
    workEnd,
    isOvernightShift,
  } = args;

  const candidateStart = new Date(proposedStartIso);
  const candidateEnd = new Date(proposedEndIso);

  if (workStart && workEnd) {
    const opHour = getOperationalHourFromDate(candidateStart);
    if (!isOperationalHourInShift(opHour, workStart, workEnd, isOvernightShift)) {
      return { state: 'outside', reason: 'خارج وقت العمل' };
    }
    const endOpHour = getOperationalHourFromDate(candidateEnd);
    if (!isOperationalHourInShift(endOpHour, workStart, workEnd, isOvernightShift)) {
      return { state: 'outside', reason: 'خارج وقت العمل' };
    }
  }

  for (const item of busyItems) {
    if (item.type === 'gap') continue;
    if (item.type === 'booking' && item.sourceId === excludeBookingId) continue;

    const existingStart = new Date(item.startTime);
    const existingEnd = new Date(item.endTime);

    if (intervalsOverlap(candidateStart, candidateEnd, existingStart, existingEnd)) {
      const label = item.customerName || item.label || '';
      return {
        state: 'conflict',
        reason: item.type === 'queue'
          ? `يتعارض مع دور ${item.ticketCode || label}`
          : `يتعارض مع موعد ${label}`,
      };
    }
  }

  return { state: 'available' };
}

function getOperationalHourFromDate(date: Date): number {
  const hour = date.getHours();
  const minute = date.getMinutes();
  if (hour >= 0 && hour <= 4) return 24 + hour + minute / 60;
  return hour + minute / 60;
}

function isOperationalHourInShift(
  hour: number,
  workStart: string,
  workEnd: string,
  isOvernight: boolean,
): boolean {
  const startHour = parseInt(workStart.split(':')[0], 10);
  let endHour = parseInt(workEnd.split(':')[0], 10);
  if (isOvernight && endHour <= 4) endHour += 24;
  if (isOvernight) return hour >= startHour || hour <= endHour;
  return hour >= startHour && hour <= endHour;
}

export async function validateMoveOnServer(args: {
  bookingId: number;
  newStartAt: string;
  operationalDate: string;
  targetEmpId?: number;
  source?: string;
}): Promise<{
  valid: boolean;
  targetEmpId?: number;
  targetEmpName?: string;
  newStartAt?: string;
  newEndAt?: string;
  message?: string;
  nextAvailable?: { startAt: string; endAt: string };
}> {
  const res = await fetch(`/api/operations/bookings/${args.bookingId}/validate-move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      newStartAt: args.newStartAt,
      operationalDate: args.operationalDate,
      targetEmpId: args.targetEmpId,
      source: args.source ?? 'operations_cut_paste',
    }),
  });
  return res.json();
}

export async function commitBookingMove(args: {
  bookingId: number;
  newStartAt: string;
  operationalDate: string;
  source?: string;
  targetEmpId?: number;
}): Promise<{
  ok: boolean;
  message?: string;
  newStartAt?: string;
  newEndAt?: string;
  oldStartAt?: string;
  oldEndAt?: string;
  oldEmpId?: number;
  newEmpId?: number;
  newEmpName?: string | null;
  customerName?: string | null;
}> {
  const res = await fetch(`/api/operations/bookings/${args.bookingId}/reschedule`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      newStartAt: args.newStartAt,
      operationalDate: args.operationalDate,
      source: args.source ?? 'operations_drag_drop',
      targetEmpId: args.targetEmpId,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, message: data.message || data.error || 'فشل نقل الموعد' };
  }
  return { ok: true, ...data };
}

/** Client-side move session — no DB changes until paste succeeds */
export interface BookingMoveSession {
  appointmentId: number;
  customerName: string;
  originalEmpId: number;
  originalEmpName: string;
  originalStartAt: string;
  originalEndAt: string;
  durationMinutes: number;
  serviceNames?: string[];
}

export interface PasteCandidateSlot {
  empId: number;
  empName: string;
  startIso: string;
  endIso: string;
  topPx: number;
  heightPx: number;
}

function nextCalendarDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function workTimeToIso(dateStr: string, hhmm: string, isNextDay: boolean): string {
  const [h, m] = hhmm.split(':').map(Number);
  const useDate = isNextDay ? nextCalendarDate(dateStr) : dateStr;
  return `${useDate}T${String(h).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}:00+03:00`;
}

/** Enumerate locally-valid paste slots on 15-minute grid (advisory only). */
export function enumeratePasteCandidateSlots(args: {
  session: BookingMoveSession;
  operationalDate: string;
  barbers: Array<{
    empId: number;
    empName: string;
    status: string;
    workStart: string | null;
    workEnd: string | null;
    isOvernightShift: boolean;
    timeline: TimelineItem[];
  }>;
}): PasteCandidateSlot[] {
  const { session, operationalDate, barbers } = args;
  const slots: PasteCandidateSlot[] = [];
  const durationMs = session.durationMinutes * 60000;

  for (const barber of barbers) {
    if (!barber.workStart || !barber.workEnd) continue;
    if (['day_off', 'absent', 'off', 'unknown'].includes(barber.status)) continue;

    const startBound = workTimeToIso(operationalDate, barber.workStart, false);
    const endIsNextDay =
      barber.isOvernightShift && parseInt(barber.workEnd.split(':')[0], 10) <= 4;
    const endBound = workTimeToIso(operationalDate, barber.workEnd, endIsNextDay);

    let cursor = new Date(startBound).getTime();
    const endMs = new Date(endBound).getTime();
    const lastStart = endMs - durationMs;

    while (cursor <= lastStart) {
      const startIso = new Date(cursor).toISOString();
      const endIso = new Date(cursor + durationMs).toISOString();

      const local = evaluateLocalBookingMove({
        proposedStartIso: startIso,
        proposedEndIso: endIso,
        busyItems: barber.timeline,
        excludeBookingId: session.appointmentId,
        workStart: barber.workStart,
        workEnd: barber.workEnd,
        isOvernightShift: barber.isOvernightShift,
      });

      if (local.state === 'available') {
        slots.push({
          empId: barber.empId,
          empName: barber.empName,
          startIso,
          endIso,
          topPx: 0, // filled by caller with getTimelineTopPx
          heightPx: 0,
        });
      }

      cursor += 15 * 60000;
    }
  }

  return slots;
}
