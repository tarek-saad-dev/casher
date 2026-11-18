import { formatTime12hAr } from '@/lib/reports/reportFormatters';
import type { LateDeductionBracket } from './rules';

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

/** Sent ONLY after an actual automatic ledger deduction succeeded. No English/preview. */
export function buildFinalDeductionMessage(params: {
  checkInTime: string;
  lateMinutes: number;
  amount: number;
  bracket: Exclude<LateDeductionBracket, 'none' | 'manager_review'>;
}): string {
  const type = params.bracket === 'quarter' ? 'ربع يوم' : 'نصف يوم';
  return [
    '✂️ *CUT SALON | إشعار خصم تأخير*',
    '',
    `وقت الحضور: ${timeLabel(params.checkInTime)}`,
    `مدة التأخير: *${params.lateMinutes} دقيقة*`,
    `الجزاء: *${type}*`,
    `قيمة الخصم: *${money(params.amount)} جنيه*`,
    '',
    'تم تسجيل الخصم في حسابك الوظيفي.',
  ].join("\n");
}

/** Sent ONLY after a manager applied a positive financial debit, never at escalation. */
export function buildManagerDecisionEmployeeMessage(params: {
  lateMinutes: number;
  amount: number;
}): string {
  return [
    '✂️ *CUT SALON | إشعار خصم تأخير*',
    '',
    `مدة التأخير: *${params.lateMinutes} دقيقة*`,
    'الجزاء: *قرار إداري*',
    `قيمة الخصم: *${money(params.amount)} جنيه*`,
    '',
    'تم اعتماد الخصم من الإدارة وتسجيله في حسابك الوظيفي.',
  ].join("\n");
}
