const ARABIC_NUMBER_OPTIONS: Intl.NumberFormatOptions = {
  numberingSystem: 'arab',
};

export type NumberScript = 'arab' | 'latin';

function getNumberingSystem(script: NumberScript): 'arab' | 'latn' {
  return script === 'arab' ? 'arab' : 'latn';
}

export function formatNumberByScript(
  value: number,
  script: NumberScript = 'arab',
  options?: Intl.NumberFormatOptions
): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('ar-EG', {
    numberingSystem: getNumberingSystem(script),
    ...options,
  }).format(safe);
}

export function formatCurrencyByScript(
  amount: number,
  script: NumberScript = 'arab',
  minFractionDigits = 0,
  maxFractionDigits = 2
): string {
  return (
    formatNumberByScript(amount, script, {
      style: 'decimal',
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    }) + ' ج.م'
  );
}

export function formatPercentByScript(
  value: number,
  script: NumberScript = 'arab',
  decimals = 1
): string {
  const safe = Number.isFinite(value) ? value : 0;
  return (
    formatNumberByScript(safe, script, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) + '%'
  );
}

export function formatDateByScript(
  date: Date | string,
  script: NumberScript = 'arab',
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('ar-EG', {
    numberingSystem: getNumberingSystem(script),
    ...options,
  });
}

export function formatArabicNumber(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('ar-EG', {
    ...ARABIC_NUMBER_OPTIONS,
    ...options,
  }).format(safe);
}

export function formatArabicCurrency(
  amount: number,
  minFractionDigits = 0,
  maxFractionDigits = 2
): string {
  return (
    formatArabicNumber(amount, {
      style: 'decimal',
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    }) + ' ج.م'
  );
}

export function formatArabicPercent(value: number, decimals = 1): string {
  const safe = Number.isFinite(value) ? value : 0;
  return (
    formatArabicNumber(safe, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) + '%'
  );
}

export function toArabicDigits(value: string | number): string {
  const str = String(value);
  return str.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[parseInt(d, 10)]);
}

export function formatArabicDate(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('ar-EG', {
    numberingSystem: 'arab',
    ...options,
  });
}

