/**
 * Placeholder renderer — ported from whatsapp-bot `services/templateRenderer.js`.
 * Keep behavior identical: required customerName, optional-line omission, Arabic list join.
 */

export const ARABIC_COMMA = '،';

const ALIAS_MAP: Record<string, string[]> = {
  customerName: ['customerName'],
  phone: ['phone'],
  invoiceNumber: ['invoiceNumber', 'orderId'],
  orderId: ['orderId', 'invoiceNumber'],
  total: ['total', 'amount'],
  amount: ['amount', 'total'],
  currency: ['currency'],
  paymentMethod: ['paymentMethod'],
  bookingId: ['bookingId', 'orderId'],
  bookingDate: ['bookingDate', 'date'],
  date: ['date', 'bookingDate'],
  bookingTime: ['bookingTime', 'time'],
  time: ['time', 'bookingTime'],
  services: ['services', 'service'],
  service: ['service', 'services'],
  employeeName: ['employeeName', 'barberName'],
  barberName: ['barberName', 'employeeName'],
  branchName: ['branchName'],
  bookingLink: ['bookingLink'],
  notes: ['notes'],
  items: ['items'],
  message: ['message'],
  workDate: ['workDate', 'date'],
  checkIn: ['checkIn'],
  checkOut: ['checkOut'],
  actualHours: ['actualHours'],
  scheduledHours: ['scheduledHours'],
  statusLabelAr: ['statusLabelAr'],
  lateMinutes: ['lateMinutes'],
  baseWage: ['baseWage'],
  fullDayBase: ['fullDayBase'],
  baseWageNoteAr: ['baseWageNoteAr'],
  targetSales: ['targetSales'],
  targetAmount: ['targetAmount'],
  deductions: ['deductions'],
  advances: ['advances'],
  dayNet: ['dayNet'],
  ledgerBalance: ['ledgerBalance'],
  payrollMonth: ['payrollMonth'],
};

export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim().length > 0;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .filter((item) => hasValue(item))
      .map((item) => String(item).trim())
      .join(`${ARABIC_COMMA} `);
  }
  return String(value).trim();
}

function resolveValue(data: Record<string, unknown>, variable: string): string | undefined {
  const keys = ALIAS_MAP[variable] ?? [variable];
  for (const key of keys) {
    if (hasValue(data[key])) {
      return formatValue(data[key]);
    }
  }
  return undefined;
}

function removeLinesContainingPlaceholder(text: string, placeholder: string): string {
  const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`);
  return text
    .split('\n')
    .filter((line) => !regex.test(line))
    .join('\n');
}

function cleanBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function renderTemplate(template: string, data: Record<string, unknown>): string {
  if (!template || typeof template !== 'string' || template.trim().length === 0) {
    throw new Error('Template is required');
  }

  const placeholderRegex = /\{\{\s*([\w]+)\s*\}\}/g;
  const placeholders = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = placeholderRegex.exec(template)) !== null) {
    placeholders.add(match[1]);
  }

  if (placeholders.has('customerName') && !hasValue(data.customerName)) {
    throw new Error('customerName is required');
  }

  let message = template;

  for (const placeholder of placeholders) {
    const value = resolveValue(data, placeholder);
    if (hasValue(value)) {
      const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g');
      message = message.replace(regex, value as string);
    }
  }

  for (const placeholder of placeholders) {
    const value = resolveValue(data, placeholder);
    if (!hasValue(value)) {
      message = removeLinesContainingPlaceholder(message, placeholder);
    }
  }

  message = cleanBlankLines(message);

  if (/\{\{\s*[\w]+\s*\}\}/.test(message)) {
    throw new Error('Template contains unresolved placeholders');
  }

  return message;
}
