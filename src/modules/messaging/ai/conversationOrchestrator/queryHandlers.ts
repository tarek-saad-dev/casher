/**
 * Ephemeral query handlers — answer NOW without mutating booking plan.
 */
import 'server-only';
import { getPublicAvailableSlots } from '@/lib/booking/publicBookingAvailability';
import { listPublicBookingBarbers } from '@/lib/booking/publicBookingBarbers';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  findAlternativeEmployeesSameTime,
  buildAlternativeEmployeesReply,
} from '../conversationIntelligence/alternativeSearch';
import { fromSnapshot } from '../planner/planState';
import type { BookingPlanSnapshot } from '../planner/types';
import type { ResolvedQueryContext } from './referenceResolver';
import type { TurnFrame } from './types';
import { resolveCustomerDateText } from '../conversationIntelligence/dateResolve';

export type QueryHandlerResult = {
  ok: boolean;
  replyText: string;
  referencedBranchCode: string | null;
  referencedBranchName: string | null;
  referencedTime: string | null;
  tool: string;
};

export async function handleAvailabilityOrEmployeesQuery(args: {
  turn: TurnFrame;
  plan: BookingPlanSnapshot | null;
  ctx: ResolvedQueryContext;
}): Promise<QueryHandlerResult> {
  const { turn, plan, ctx } = args;
  const branchCode = ctx.branchCode || 'CAMP_CAESAR';
  const date =
    (turn.entities.dateHint
      ? resolveCustomerDateText(turn.entities.dateHint).date
      : null) ||
    ctx.date ||
    getCairoBusinessDate();

  // NOW / who is there → list barbers for branch (not booking slot search)
  if (turn.temporal === 'now' || turn.primaryIntent === 'AVAILABILITY_QUERY') {
    try {
      const list = await listPublicBookingBarbers({
        mode: 'branch',
        branchCode,
        date,
      });
      const names = list.barbers
        .slice(0, 6)
        .map((b) => b.nameAr || b.name)
        .filter(Boolean);
      const branchLabel = list.branch?.branchName || ctx.branchName || branchCode;
      if (!names.length) {
        return {
          ok: true,
          replyText: `حالياً مفيش صنايعية ظاهرين للحجز في ${branchLabel}. تحب أشوفلك ميعاد تاني؟`,
          referencedBranchCode: branchCode,
          referencedBranchName: branchLabel,
          referencedTime: null,
          tool: 'list_employees',
        };
      }
      const body = names.map((n) => `- ${n}`).join('\n');
      const repairPrefix = turn.repairMode ? 'معلش، فهمتك غلط. ' : '';
      return {
        ok: true,
        replyText: `${repairPrefix}في ${branchLabel} دلوقتي متاح للحجز:\n${body}`,
        referencedBranchCode: branchCode,
        referencedBranchName: branchLabel,
        referencedTime: null,
        tool: 'list_employees',
      };
    } catch (err) {
      return {
        ok: false,
        replyText: 'مقدرش أجيب الموظفين دلوقتي من السيستم. جرّب تاني بعد شوية.',
        referencedBranchCode: branchCode,
        referencedBranchName: ctx.branchName,
        referencedTime: null,
        tool: 'list_employees',
      };
    }
  }

  // Inherited/explicit time + alt employees via slots
  if (plan && (turn.primaryIntent === 'BOOKING_ALTERNATIVE_QUERY' || ctx.timeHm)) {
    const mutable = fromSnapshot(plan);
    if (ctx.timeHm && !mutable.selectedSlot) {
      mutable.timePreference = {
        kind: 'exact',
        timeHm: ctx.timeHm,
        label: ctx.timeHm,
      };
    }
    if (ctx.branchCode) {
      mutable.branchCode = ctx.branchCode;
      mutable.branchName = ctx.branchName;
    }
    // Do not persist — only query
    const alt = await findAlternativeEmployeesSameTime(mutable);
    return {
      ok: alt.ok,
      replyText: buildAlternativeEmployeesReply(fromSnapshot(plan), alt),
      referencedBranchCode: plan.branchCode,
      referencedBranchName: plan.branchName,
      referencedTime: alt.targetTime,
      tool: 'alternative_employee_search',
    };
  }

  // Branch query with inherited time: slots at that branch
  if (turn.primaryIntent === 'BRANCH_QUERY' && ctx.serviceIds.length && date) {
    try {
      const slots = await getPublicAvailableSlots({
        branchCode,
        date,
        serviceIds: ctx.serviceIds,
        empId: null,
      });
      const target = ctx.timeHm;
      const atTime = target
        ? slots.slots.find((s) => s.time === target)
        : slots.slots[0];
      const barbers = (atTime?.barbers ?? []).slice(0, 5);
      const names = barbers.map((b) => b.nameAr || String(b.empId));
      const branchLabel = slots.branch?.branchName || ctx.branchName || branchCode;
      if (!names.length) {
        return {
          ok: true,
          replyText: `في ${branchLabel} مفيش مواعيد قريبة لنفس الخدمة دلوقتي. تحب وقت تاني؟`,
          referencedBranchCode: branchCode,
          referencedBranchName: branchLabel,
          referencedTime: target,
          tool: 'get_availability',
        };
      }
      const timeLabel = atTime?.time || target || 'قريب';
      return {
        ok: true,
        replyText: `في ${branchLabel} حوالي الساعة ${timeLabel} متاح:\n${names.map((n) => `- ${n}`).join('\n')}\n\nلو حابب نغيّر الحجز هناك قولي بصراحة "خليه في جليم".`,
        referencedBranchCode: branchCode,
        referencedBranchName: branchLabel,
        referencedTime: atTime?.time ?? target,
        tool: 'get_availability',
      };
    } catch {
      return {
        ok: false,
        replyText: 'مقدرش أشوف مواعيد الفرع دلوقتي.',
        referencedBranchCode: branchCode,
        referencedBranchName: ctx.branchName,
        referencedTime: ctx.timeHm,
        tool: 'get_availability',
      };
    }
  }

  return {
    ok: false,
    replyText: 'مش واضح قصدك مين/أنهي فرع. وضّح وأنا أشيّك من السيستم.',
    referencedBranchCode: ctx.branchCode,
    referencedBranchName: ctx.branchName,
    referencedTime: ctx.timeHm,
    tool: 'none',
  };
}

export function buildKeepContextReply(plan: BookingPlanSnapshot | null): string {
  if (!plan?.selectedSlot) {
    return 'ماشي، هنكمّل على حجزك الحالي. تحب نكمّل منين؟';
  }
  const who = plan.employeeName || 'الفني';
  const when = plan.selectedSlot.label || plan.selectedSlot.time;
  return `ماشي، هنفضّل مع ${who} الساعة ${when}. تحب أأكدلك الحجز؟`;
}

export function buildStaleConfirmClarifyReply(plan: BookingPlanSnapshot | null): string {
  const who = plan?.employeeName || 'الحجز الحالي';
  const when = plan?.selectedSlot?.label || plan?.selectedSlot?.time || '';
  return `تقصد نكمّل حجز ${who}${when ? ` الساعة ${when}` : ''}، ولا كنت بتقصد حاجة تانية من اللي سألت عليها؟`;
}
