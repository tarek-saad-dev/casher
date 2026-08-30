/**
 * Owner-approved fixed customer-facing branch hours for Salon Concierge.
 * Not ERP hours. Not booking-engine availability.
 */
export type ConciergeBranchCode = 'GLEEM' | 'CAMP_CAESAR';

export type FixedBranchHours = {
  branchCode: ConciergeBranchCode;
  displayNameAr: string;
  shortNameAr: string;
  openMinutes: number;
  closeMinutes: number;
  closeDayOffset: 1;
  scheduleLabelAr: string;
  closeLabelAr: string;
  openLabelAr: string;
};

export const CONCIERGE_FIXED_BRANCH_HOURS: Record<ConciergeBranchCode, FixedBranchHours> = {
  GLEEM: {
    branchCode: 'GLEEM',
    displayNameAr: 'فرع جليم',
    shortNameAr: 'جليم',
    openMinutes: 11 * 60,
    closeMinutes: 2 * 60,
    closeDayOffset: 1,
    scheduleLabelAr: 'من 11 صباحًا لحد 2 بعد منتصف الليل',
    closeLabelAr: '2 بعد منتصف الليل',
    openLabelAr: '11 صباحًا',
  },
  CAMP_CAESAR: {
    branchCode: 'CAMP_CAESAR',
    displayNameAr: 'فرع كامب شيزار',
    shortNameAr: 'كامب شيزار',
    openMinutes: 12 * 60,
    closeMinutes: 1 * 60,
    closeDayOffset: 1,
    scheduleLabelAr: 'من 12 ظهرًا لحد 1 بعد منتصف الليل',
    closeLabelAr: '1 بعد منتصف الليل',
    openLabelAr: '12 ظهرًا',
  },
};

export const CONCIERGE_BRANCH_ORDER: ConciergeBranchCode[] = ['GLEEM', 'CAMP_CAESAR'];

const CAIRO_TZ = 'Africa/Cairo';

export function cairoNowMinutes(now = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: CAIRO_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

/** Overnight window: open from openMinutes through midnight, then until closeMinutes (exclusive). */
export function isConciergeBranchOpenAt(
  branchCode: ConciergeBranchCode,
  nowMinutes: number,
): boolean {
  const h = CONCIERGE_FIXED_BRANCH_HOURS[branchCode];
  return nowMinutes >= h.openMinutes || nowMinutes < h.closeMinutes;
}

export function formatConciergeBranchSchedule(branchCode: ConciergeBranchCode): string {
  const h = CONCIERGE_FIXED_BRANCH_HOURS[branchCode];
  return `${h.displayNameAr} شغال يوميًا ${h.scheduleLabelAr}.`;
}

export function formatConciergeAllBranchSchedules(): string {
  return CONCIERGE_BRANCH_ORDER.map((code) => formatConciergeBranchSchedule(code)).join('\n');
}

export function formatConciergeOpenNowSingle(
  branchCode: ConciergeBranchCode,
  nowMinutes: number,
): string {
  const h = CONCIERGE_FIXED_BRANCH_HOURS[branchCode];
  if (isConciergeBranchOpenAt(branchCode, nowMinutes)) {
    return `${h.shortNameAr} فاتح دلوقتي لحد ${h.closeLabelAr}.`;
  }
  return `${h.shortNameAr} مقفول دلوقتي. بيفتح الساعة ${h.openLabelAr}.`;
}

export function formatConciergeOpenNowAll(nowMinutes: number): string {
  const gleem = CONCIERGE_FIXED_BRANCH_HOURS.GLEEM;
  const camp = CONCIERGE_FIXED_BRANCH_HOURS.CAMP_CAESAR;
  const gleemOpen = isConciergeBranchOpenAt('GLEEM', nowMinutes);
  const campOpen = isConciergeBranchOpenAt('CAMP_CAESAR', nowMinutes);

  if (gleemOpen && campOpen) {
    return [
      'أيوه يا فندم، الفرعين فاتحين دلوقتي:',
      `${gleem.shortNameAr} لحد ${gleem.closeLabelAr}،`,
      `و${camp.shortNameAr} لحد ${camp.closeLabelAr}.`,
    ].join('\n');
  }

  if (gleemOpen && !campOpen) {
    return `${gleem.shortNameAr} فاتح دلوقتي لحد ${gleem.closeLabelAr}، و${camp.shortNameAr} قفل الساعة ${camp.closeLabelAr}.`;
  }

  if (!gleemOpen && campOpen) {
    return `${camp.shortNameAr} فاتح دلوقتي لحد ${camp.closeLabelAr}، و${gleem.shortNameAr} مقفول حاليًا.`;
  }

  return [
    'مقفلين حاليًا.',
    `${gleem.displayNameAr} بيفتح الساعة ${gleem.openLabelAr}،`,
    `و${camp.displayNameAr} بيفتح الساعة ${camp.openLabelAr}.`,
  ].join('\n');
}

export function conciergeHoursKnowledgeRows(): Array<{
  key: string;
  branchCode: ConciergeBranchCode | null;
  title: string;
  subject: string;
  answerText: string;
  aliases: string[];
}> {
  return [
    {
      key: 'hours.gleem.fixed',
      branchCode: 'GLEEM',
      title: 'مواعيد جليم',
      subject: 'مواعيد فرع جليم',
      answerText: formatConciergeBranchSchedule('GLEEM'),
      aliases: ['مواعيد جليم', 'ساعات جليم', 'جليم بيفتح امتى', 'مواعيد عمل جليم'],
    },
    {
      key: 'hours.camp_caesar.fixed',
      branchCode: 'CAMP_CAESAR',
      title: 'مواعيد كامب شيزار',
      subject: 'مواعيد فرع كامب',
      answerText: formatConciergeBranchSchedule('CAMP_CAESAR'),
      aliases: ['مواعيد كامب', 'مواعيد كامب شيزار', 'كامب بيفتح امتى', 'ساعات كامب'],
    },
    {
      key: 'hours.branches.fixed',
      branchCode: null,
      title: 'مواعيد الفروع',
      subject: 'مواعيد الفروع',
      answerText: formatConciergeAllBranchSchedules(),
      aliases: ['مواعيد الفروع', 'ساعات العمل', 'مواعيد العمل', 'بتفتحوا امتى'],
    },
  ];
}
