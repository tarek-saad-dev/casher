export function formatPartnersCurrency(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe) + ' ج.م';
}

export function formatPartnersPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toFixed(1) + '%';
}

/** راتب+تارجت + سلف — نفس أرقام جدول الموظفين بعد أي تعديل يدوي */
export function partnersEmployeePaidTotal(totals: {
  totalPaidSalaryAndAdvances: number;
  totalSalaryAndTarget?: number;
  totalAdvanceExcess?: number;
}): number {
  if (totals.totalSalaryAndTarget != null || totals.totalAdvanceExcess != null) {
    const paid =
      (Number.isFinite(totals.totalSalaryAndTarget) ? totals.totalSalaryAndTarget! : 0) +
      (Number.isFinite(totals.totalAdvanceExcess) ? totals.totalAdvanceExcess! : 0);
    return Math.round(paid * 100) / 100;
  }
  return Number.isFinite(totals.totalPaidSalaryAndAdvances)
    ? totals.totalPaidSalaryAndAdvances
    : 0;
}

export const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export const REPORT_YEARS = Array.from(
  { length: 7 },
  (_, i) => new Date().getFullYear() - 3 + i
);
