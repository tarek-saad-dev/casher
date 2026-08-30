/**
 * Concierge advisor — grounded alternatives only (max 2–3).
 * Does not invent availability or employee quality.
 */
export type AdvisorOption = {
  label: string;
  kind:
    | 'same_employee_near'
    | 'same_time_other_employee'
    | 'other_branch'
    | 'nearby_day'
    | 'capability_specialist'
    | 'consultation';
};

export function buildUnavailableEmployeeAdvice(args: {
  employeeName: string;
  requestedTimeLabel: string;
  alternatives: AdvisorOption[];
}): string {
  const alts = args.alternatives.slice(0, 3);
  if (!alts.length) {
    return `${args.employeeName} الساعة ${args.requestedTimeLabel} مش متاح حالياً، ومفيش بديل قريب مؤكد دلوقتي.`;
  }
  return `${args.employeeName} الساعة ${args.requestedTimeLabel} مش متاح. ${alts.map((a) => a.label).join('، ')}`;
}

export function buildCapabilityAdvice(args: {
  capabilityName: string;
  description: string | null;
  employeeNames: string[];
  branchCodes: string[];
  askedBranch?: string | null;
}): string {
  const who =
    args.employeeNames.length > 0
      ? `المسجّلين للكفاءة دي: ${args.employeeNames.join('، ')}.`
      : 'مفيش أسماء محددة مسجّلة للكفاءة دي — الاستقبال يقدر يوجّهك.';
  const where =
    args.askedBranch && args.branchCodes.includes(args.askedBranch)
      ? 'متاحة في الفرع اللي سألت عليه.'
      : args.branchCodes.length
        ? `الفروع المسجّلة: ${args.branchCodes.join('، ')}.`
        : '';
  const desc = args.description ? `${args.description} ` : '';
  return `${args.capabilityName}: ${desc}${who} ${where}`.trim();
}

export function buildConsultativeAdvice(args: {
  capabilityName: string;
  description: string | null;
  askOneQuestion: boolean;
}): string {
  const base = args.description
    ? `${args.capabilityName}: ${args.description}`
    : args.capabilityName;
  if (!args.askOneQuestion) {
    return `${base} التقييم النهائي بيتم في الصالون حسب حالة الشعر.`.trim();
  }
  return `${base} لو تقولي اللون اللي في بالك وحالة شعرك تقريبًا، أقدر أرشحلك الأنسب وأشوفلك أقرب ميعاد.`.trim();
}

export function assertNoQualityRanking(text: string): boolean {
  return !/أحسن واحد|أفضل حلاق|رقم واحد|أشطر/.test(text);
}
