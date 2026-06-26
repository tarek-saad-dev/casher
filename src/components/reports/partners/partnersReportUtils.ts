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

export const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export const REPORT_YEARS = Array.from(
  { length: 7 },
  (_, i) => new Date().getFullYear() - 3 + i
);
