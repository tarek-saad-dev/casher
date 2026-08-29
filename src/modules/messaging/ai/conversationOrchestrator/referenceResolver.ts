/**
 * Deterministic reference resolution using recent turns + active booking.
 */
import type { BookingPlanSnapshot } from '../planner/types';
import type { SessionMemory, TurnFrame } from './types';
import { getCairoBusinessDate } from '@/lib/businessDate';

export type ResolvedQueryContext = {
  branchCode: string | null;
  branchName: string | null;
  branchHint: string | null;
  serviceIds: number[];
  serviceNames: string[];
  empId: number | null;
  employeeName: string | null;
  date: string | null;
  timeHm: string | null;
  temporal: TurnFrame['temporal'];
  excludeEmpId: number | null;
};

export function resolveReferences(args: {
  turn: TurnFrame;
  plan: BookingPlanSnapshot | null;
  session: SessionMemory;
}): ResolvedQueryContext {
  const { turn, plan, session } = args;
  let branchCode = plan?.branchCode ?? null;
  let branchName = plan?.branchName ?? null;
  let branchHint = turn.entities.branchHint;

  // "هناك" → last referenced branch, else plan branch
  if (turn.references.there) {
    if (session.lastReferencedBranchCode) {
      branchCode = session.lastReferencedBranchCode;
      branchName = session.lastReferencedBranchName;
    }
  }

  if (branchHint) {
    if (/جليم/.test(branchHint)) {
      branchCode = 'GLEEM';
      branchName = 'جليم';
    } else if (/كامب/.test(branchHint)) {
      branchCode = 'CAMP_CAESAR';
      branchName = 'كامب شيزار';
    }
  }

  let date = plan?.requestedDate ?? getCairoBusinessDate();
  if (turn.entities.dateHint) {
    // leave date hint for caller to resolve via resolveCustomerDateText
  }

  let timeHm: string | null = null;
  if (turn.temporal === 'now') {
    timeHm = null; // NOW — do not inherit booking slot
  } else if (turn.temporal === 'inherited' || turn.references.thatTime || turn.references.sameTime) {
    timeHm =
      session.lastReferencedTime ||
      plan?.selectedSlot?.time ||
      plan?.timePreference?.timeHm ||
      null;
  } else if (turn.temporal === 'explicit') {
    // parse digits — night booking context: 10 → 22 if plan evening
    const m = turn.rawText.match(/(\d{1,2})/);
    if (m) {
      let h = Number(m[1]);
      const night = /بليل|مساء|بالليل/.test(turn.rawText) || (plan?.selectedSlot?.time && plan.selectedSlot.time >= '18:00');
      if (night && h > 0 && h <= 12) h += 12;
      timeHm = `${String(h).padStart(2, '0')}:00`;
    }
  }

  return {
    branchCode,
    branchName,
    branchHint,
    serviceIds: plan?.serviceIds ? [...plan.serviceIds] : [],
    serviceNames: plan?.serviceNames ? [...plan.serviceNames] : [],
    empId: plan?.empId ?? null,
    employeeName: plan?.employeeName ?? null,
    date,
    timeHm,
    temporal: turn.temporal,
    excludeEmpId: plan?.empId ?? null,
  };
}
