/** Human-friendly agreement date helpers. Always operate on ISO business dates. */
export function firstDayOfNextMonth(today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) ||
      Number.isNaN(Date.parse(today)) ||
      new Date(today + 'T00:00:00Z').toISOString().slice(0, 10) !== today) {
    throw new Error('Invalid Cairo business date');
  }
  const [year, month] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}
export function formatPayrollEffectiveDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    return '';
  }
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(value + 'T12:00:00Z'));
}
