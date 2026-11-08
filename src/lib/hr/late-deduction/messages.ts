import { formatTime12hAr } from '@/lib/reports/reportFormatters';
import { labelForBracket, type LateDeductionBracket } from './rules';

export function buildLateDeductionLedgerNote(params: {
  workDate: string;
  lateMinutes: number;
  kind: string;
}): string {
  return `خصم تأخير تلقائي | ${params.workDate} | ${params.lateMinutes} دقيقة | ${params.kind}`;
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function timeLabel(hhmm: string): string {
  return formatTime12hAr(hhmm) ?? hhmm;
}

export function buildLateAlertMessage(params: {
  threshold: 1 | 61 | 121;
  scheduledStart: string;
  lateMinutes: number;
  quarterAmount: number | null;
  halfAmount: number | null;
  exempt: boolean;
}): string {
  const start = timeLabel(params.scheduledStart);
  const delay = params.lateMinutes;

  if (params.exempt) {
    if (params.threshold === 1) {
      return [
        '⏰ *Attendance Reminder | CUT SALON*',
        '',
        `Your scheduled start time was ${start}, and you have not checked in yet.`,
        `Current delay: *${delay} minute${delay === 1 ? '' : 's'}*`,
        '',
        'Please attend as soon as possible.',
      ].join('\n');
    }
    if (params.threshold === 61) {
      return [
        '⚠️ *Attendance Update | CUT SALON*',
        '',
        'You have not checked in yet.',
        `Current delay: *${delay} minutes*`,
        '',
        'Please attend as soon as possible.',
      ].join('\n');
    }
    return [
      '🚨 *Attendance Escalation | CUT SALON*',
      '',
      `Current delay: *${delay} minutes*`,
      '',
      'Your attendance case has been referred to management.',
      'Please check in immediately upon arrival.',
    ].join('\n');
  }

  if (params.threshold === 1) {
    const amt = params.quarterAmount != null ? money(params.quarterAmount) : 'N/A';
    return [
      '⏰ *Late Attendance Alert | CUT SALON*',
      '',
      `Your scheduled start time was ${start}, and you have not checked in yet.`,
      '',
      `Current delay: *${delay} minute${delay === 1 ? '' : 's'}*`,
      '',
      '⚠️ You have entered the *quarter-day deduction bracket*.',
      '',
      `Potential deduction: *${amt} EGP*`,
      '',
      'Please attend as soon as possible.',
    ].join('\n');
  }

  if (params.threshold === 61) {
    const amt = params.halfAmount != null ? money(params.halfAmount) : 'N/A';
    return [
      '⚠️ *Late Attendance Update | CUT SALON*',
      '',
      'You have not checked in yet.',
      '',
      `Current delay: *${delay} minutes*`,
      '',
      'Your potential deduction has increased from a quarter-day to a *half-day deduction*.',
      '',
      `Potential deduction: *${amt} EGP*`,
      '',
      'Please attend as soon as possible.',
    ].join('\n');
  }

  return [
    '🚨 *Late Attendance Escalation | CUT SALON*',
    '',
    `Current delay: *${delay} minutes*`,
    '',
    'You have exceeded the automatic deduction threshold.',
    '',
    'Your attendance case has been referred to management to determine the appropriate penalty.',
    '',
    'Please check in immediately upon arrival.',
  ].join('\n');
}

export function buildFinalDeductionMessage(params: {
  checkInTime: string;
  lateMinutes: number;
  amount: number;
  bracket: Exclude<LateDeductionBracket, 'none' | 'manager_review'>;
}): string {
  const kindAr =
    params.bracket === 'quarter' ? 'ربع يوم' : params.bracket === 'half' ? 'نصف يوم' : labelForBracket(params.bracket);
  return [
    '✅ *تم تسجيل الحضور | CUT SALON*',
    '',
    `وقت الحضور: ${timeLabel(params.checkInTime)}`,
    '',
    `مدة التأخير: ${params.lateMinutes} دقيقة`,
    '',
    `الخصم المُطبَّق: *${money(params.amount)} ج.م*`,
    '',
    `نوع الخصم: ${kindAr}`,
    '',
    'تم تسجيل الخصم في حسابك الوظيفي.',
    '',
    '—',
    '',
    '✅ *Attendance Recorded | CUT SALON*',
    `Check-in: ${timeLabel(params.checkInTime)}`,
    `Late: ${params.lateMinutes} min · Deduction: *${money(params.amount)} EGP* (${labelForBracket(params.bracket)})`,
  ].join('\n');
}

export function buildExemptCheckInLateMessage(params: {
  checkInTime: string;
  lateMinutes: number;
}): string {
  return [
    '✅ *Attendance Recorded | CUT SALON*',
    '',
    `Check-in: ${timeLabel(params.checkInTime)}`,
    '',
    `Late duration: ${params.lateMinutes} minutes`,
    '',
    'No automatic late deduction was applied (exempt).',
  ].join('\n');
}

export function buildManagerDecisionEmployeeMessage(params: {
  lateMinutes: number;
  amount: number;
}): string {
  return [
    '✅ *قرار خصم التأخير | CUT SALON*',
    '',
    `مدة التأخير: ${params.lateMinutes} دقيقة`,
    '',
    `الخصم المُطبَّق: *${money(params.amount)} ج.م*`,
    '',
    'تم اعتماد خصم التأخير من الإدارة وتسجيله في حسابك.',
    '',
    '—',
    '',
    '✅ *Late Attendance Decision | CUT SALON*',
    `Late: ${params.lateMinutes} min · Deduction: *${money(params.amount)} EGP*`,
  ].join('\n');
}

/** Employee-facing notice after check-in beyond the automatic threshold. */
export function buildManagerReviewEmployeeAckMessage(params: {
  checkInTime: string;
  lateMinutes: number;
}): string {
  return [
    '🚨 *Late Attendance Escalation | CUT SALON*',
    '',
    `Check-in: ${timeLabel(params.checkInTime)}`,
    '',
    `Late duration: ${params.lateMinutes} minutes`,
    '',
    'You have exceeded the automatic deduction threshold.',
    '',
    'Your attendance case has been referred to management to determine the appropriate penalty.',
  ].join('\n');
}
