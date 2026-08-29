/**
 * Pure reply builders for alternative availability (no DB / server I/O).
 */
import type { MutablePlan } from '../planner/planState';

export type AlternativeEmployee = {
  empId: number;
  name: string;
  time: string;
  branchCode?: string | null;
};

export type AlternativeSearchResult = {
  ok: boolean;
  targetTime: string | null;
  alternatives: AlternativeEmployee[];
  nearbyOtherTimes: AlternativeEmployee[];
  errorCode?: string;
};

export function buildAlternativeEmployeesReply(
  plan: MutablePlan,
  result: AlternativeSearchResult,
): string {
  const timeLabel = plan.selectedSlot?.label || result.targetTime || 'الوقت ده';
  const current = plan.employeeName || 'الفني الحالي';

  if (!result.ok) {
    return 'مقدرش أشوف البدائل دلوقتي. تحب نكمل على الحجز الحالي ولا تغيّر الميعاد؟';
  }

  if (result.alternatives.length) {
    const names = result.alternatives.map((a) => a.name).slice(0, 3);
    const list = names.map((n) => `- ${n}`).join('\n');
    return [
      `الساعة ${timeLabel} متاح كمان:`,
      list,
      '',
      `تحب تفضل مع ${current} ولا أغيّر لمين؟`,
    ].join('\n');
  }

  if (result.nearbyOtherTimes.length) {
    const lines = result.nearbyOtherTimes
      .slice(0, 3)
      .map((a) => `- ${a.name} الساعة ${a.time}`);
    return [
      `الساعة ${timeLabel} ${current} هو المتاح.`,
      'أقرب بدائل مع صنايعية تانيين:',
      ...lines,
      '',
      'تحب تغيّر ولا نكمّل على الحالي؟',
    ].join('\n');
  }

  return `الساعة ${timeLabel} ${current} هو المتاح حالياً لنفس الخدمة. تحب نكمّل ولا نشوف ميعاد تاني؟`;
}
