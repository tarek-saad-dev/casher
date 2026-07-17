/**
 * WhatsApp Integration — Payload Validation
 *
 * Lightweight validation without Zod (project has no Zod dependency).
 * Matches the validation convention used in the rest of the codebase.
 */

import type {
  WhatsAppPayload,
  SaleWhatsAppPayload,
  BookingWhatsAppPayload,
  FirstTimeWhatsAppPayload,
  EmployeeSaleWhatsAppPayload,
  EmployeeAdvanceWhatsAppPayload,
  EmployeeFundingWhatsAppPayload,
  QuickMessageWhatsAppPayload,
  EmployeeDailyReportWhatsAppPayload,
  OtherWhatsAppPayload,
  WhatsAppExtraVariables,
} from './types';
import { PROTECTED_FIELDS } from './types';
import { WhatsAppValidationError } from './errors';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WhatsAppValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function assertFiniteNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!isFinite(n)) {
    throw new WhatsAppValidationError(`${field} must be a finite number`);
  }
  return n;
}

function validateExtraVariables(vars: unknown): WhatsAppExtraVariables {
  if (vars === undefined || vars === null) return {};
  if (typeof vars !== 'object' || Array.isArray(vars)) {
    throw new WhatsAppValidationError('variables must be a plain object');
  }
  const result: WhatsAppExtraVariables = {};
  for (const [key, val] of Object.entries(vars as Record<string, unknown>)) {
    if (PROTECTED_FIELDS.includes(key as (typeof PROTECTED_FIELDS)[number])) {
      throw new WhatsAppValidationError(
        `variables cannot overwrite protected field: ${key}`,
      );
    }
    if (
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean' ||
      val === null ||
      (Array.isArray(val) && val.every((v) => typeof v === 'string'))
    ) {
      result[key] = val as string | number | boolean | null | string[];
    } else {
      throw new WhatsAppValidationError(
        `variables.${key} must be string, number, boolean, null, or string[]`,
      );
    }
  }
  return result;
}

export function validateSalePayload(input: unknown): SaleWhatsAppPayload {
  if (typeof input !== 'object' || input === null) {
    throw new WhatsAppValidationError('Payload must be an object');
  }
  const p = input as Record<string, unknown>;

  const payload: SaleWhatsAppPayload = {
    type: 'sale',
    phone: assertNonEmptyString(p.phone, 'phone'),
    customerName: assertNonEmptyString(p.customerName, 'customerName'),
  };

  if (p.invoiceNumber !== undefined)
    payload.invoiceNumber = assertNonEmptyString(p.invoiceNumber, 'invoiceNumber');
  if (p.total !== undefined)
    payload.total = assertFiniteNumber(p.total, 'total');
  if (p.paymentMethod !== undefined && typeof p.paymentMethod === 'string')
    payload.paymentMethod = p.paymentMethod;
  if (p.branchName !== undefined && typeof p.branchName === 'string')
    payload.branchName = p.branchName;
  if (p.employeeName !== undefined && typeof p.employeeName === 'string')
    payload.employeeName = p.employeeName;
  if (Array.isArray(p.services) && p.services.every((s) => typeof s === 'string'))
    payload.services = p.services as string[];
  if (p.variables !== undefined)
    payload.variables = validateExtraVariables(p.variables);

  return payload;
}

export function validateBookingPayload(input: unknown): BookingWhatsAppPayload {
  if (typeof input !== 'object' || input === null) {
    throw new WhatsAppValidationError('Payload must be an object');
  }
  const p = input as Record<string, unknown>;

  const bookingDate = assertNonEmptyString(p.bookingDate, 'bookingDate');
  if (!DATE_RE.test(bookingDate)) {
    throw new WhatsAppValidationError('bookingDate must be YYYY-MM-DD');
  }
  const bookingTime = assertNonEmptyString(p.bookingTime, 'bookingTime');
  if (!TIME_RE.test(bookingTime)) {
    throw new WhatsAppValidationError('bookingTime must be HH:mm');
  }

  const payload: BookingWhatsAppPayload = {
    type: 'booking',
    phone: assertNonEmptyString(p.phone, 'phone'),
    customerName: assertNonEmptyString(p.customerName, 'customerName'),
    bookingDate,
    bookingTime,
  };

  if (p.bookingId !== undefined && typeof p.bookingId === 'string')
    payload.bookingId = p.bookingId;
  if (p.branchName !== undefined && typeof p.branchName === 'string')
    payload.branchName = p.branchName;
  if (p.barberName !== undefined && typeof p.barberName === 'string')
    payload.barberName = p.barberName;
  if (Array.isArray(p.services) && p.services.every((s) => typeof s === 'string'))
    payload.services = p.services as string[];
  if (p.bookingLink !== undefined && typeof p.bookingLink === 'string')
    payload.bookingLink = p.bookingLink;
  if (p.variables !== undefined)
    payload.variables = validateExtraVariables(p.variables);

  return payload;
}

export function validateFirstTimePayload(input: unknown): FirstTimeWhatsAppPayload {
  if (typeof input !== 'object' || input === null) {
    throw new WhatsAppValidationError('Payload must be an object');
  }
  const p = input as Record<string, unknown>;

  const payload: FirstTimeWhatsAppPayload = {
    type: 'first_time',
    phone: assertNonEmptyString(p.phone, 'phone'),
    customerName: assertNonEmptyString(p.customerName, 'customerName'),
  };

  if (p.branchName !== undefined && typeof p.branchName === 'string')
    payload.branchName = p.branchName;
  if (p.bookingLink !== undefined && typeof p.bookingLink === 'string')
    payload.bookingLink = p.bookingLink;
  if (p.variables !== undefined)
    payload.variables = validateExtraVariables(p.variables);

  return payload;
}

export function validateEmployeeSalePayload(input: unknown): EmployeeSaleWhatsAppPayload {
  if (typeof input !== 'object' || input === null) {
    throw new WhatsAppValidationError('Payload must be an object');
  }
  const p = input as Record<string, unknown>;

  const payload: EmployeeSaleWhatsAppPayload = {
    type: 'employee_sale',
    phone: assertNonEmptyString(p.phone, 'phone'),
    customerName: assertNonEmptyString(p.customerName, 'customerName'),
  };

  if (p.invoiceNumber !== undefined)
    payload.invoiceNumber = assertNonEmptyString(p.invoiceNumber, 'invoiceNumber');
  if (p.branchName !== undefined && typeof p.branchName === 'string')
    payload.branchName = p.branchName;
  if (Array.isArray(p.services) && p.services.every((s) => typeof s === 'string'))
    payload.services = p.services as string[];
  if (p.variables !== undefined)
    payload.variables = validateExtraVariables(p.variables);

  return payload;
}

export function validateEmployeeAdvancePayload(
  input: unknown,
): EmployeeAdvanceWhatsAppPayload {
  if (typeof input !== 'object' || input === null) {
    throw new WhatsAppValidationError('Payload must be an object');
  }
  const p = input as Record<string, unknown>;

  const payload: EmployeeAdvanceWhatsAppPayload = {
    type: 'employee_advance',
    phone: assertNonEmptyString(p.phone, 'phone'),
    customerName: assertNonEmptyString(p.customerName, 'customerName'),
  };

  if (p.invoiceNumber !== undefined)
    payload.invoiceNumber = assertNonEmptyString(p.invoiceNumber, 'invoiceNumber');
  if (p.amount !== undefined)
    payload.amount = assertFiniteNumber(p.amount, 'amount');
  if (p.paymentMethod !== undefined && typeof p.paymentMethod === 'string')
    payload.paymentMethod = p.paymentMethod;
  if (p.branchName !== undefined && typeof p.branchName === 'string')
    payload.branchName = p.branchName;
  if (p.notes !== undefined && typeof p.notes === 'string')
    payload.notes = p.notes;
  if (p.variables !== undefined)
    payload.variables = validateExtraVariables(p.variables);

  return payload;
}

export function validateEmployeeFundingPayload(
  input: unknown,
): EmployeeFundingWhatsAppPayload {
  if (typeof input !== 'object' || input === null) {
    throw new WhatsAppValidationError('Payload must be an object');
  }
  const p = input as Record<string, unknown>;

  const payload: EmployeeFundingWhatsAppPayload = {
    type: 'employee_funding',
    phone: assertNonEmptyString(p.phone, 'phone'),
    customerName: assertNonEmptyString(p.customerName, 'customerName'),
  };

  if (p.invoiceNumber !== undefined)
    payload.invoiceNumber = assertNonEmptyString(p.invoiceNumber, 'invoiceNumber');
  if (p.amount !== undefined)
    payload.amount = assertFiniteNumber(p.amount, 'amount');
  if (p.paymentMethod !== undefined && typeof p.paymentMethod === 'string')
    payload.paymentMethod = p.paymentMethod;
  if (p.branchName !== undefined && typeof p.branchName === 'string')
    payload.branchName = p.branchName;
  if (p.notes !== undefined && typeof p.notes === 'string')
    payload.notes = p.notes;
  if (p.variables !== undefined)
    payload.variables = validateExtraVariables(p.variables);

  return payload;
}

export function validateQuickMessagePayload(input: unknown): QuickMessageWhatsAppPayload {
  if (typeof input !== 'object' || input === null) {
    throw new WhatsAppValidationError('Payload must be an object');
  }
  const p = input as Record<string, unknown>;

  const payload: QuickMessageWhatsAppPayload = {
    type: 'quick_message',
    phone: assertNonEmptyString(p.phone, 'phone'),
    customerName: assertNonEmptyString(p.customerName, 'customerName'),
    message: assertNonEmptyString(p.message, 'message'),
  };

  if (p.branchName !== undefined && typeof p.branchName === 'string')
    payload.branchName = p.branchName;
  if (p.variables !== undefined)
    payload.variables = validateExtraVariables(p.variables);

  return payload;
}

function optionalFiniteNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return assertFiniteNumber(value, field);
}

export function validateOtherPayload(input: unknown): OtherWhatsAppPayload {
  if (typeof input !== 'object' || input === null) {
    throw new WhatsAppValidationError('Payload must be an object');
  }
  const p = input as Record<string, unknown>;

  const payload: OtherWhatsAppPayload = {
    type: 'other',
    phone: assertNonEmptyString(p.phone, 'phone'),
    customerName: assertNonEmptyString(p.customerName, 'customerName'),
    message: assertNonEmptyString(p.message, 'message'),
  };

  if (p.branchName !== undefined && typeof p.branchName === 'string')
    payload.branchName = p.branchName;
  if (p.variables !== undefined)
    payload.variables = validateExtraVariables(p.variables);

  return payload;
}

export function validateEmployeeDailyReportPayload(
  input: unknown,
): EmployeeDailyReportWhatsAppPayload {
  if (typeof input !== 'object' || input === null) {
    throw new WhatsAppValidationError('Payload must be an object');
  }
  const p = input as Record<string, unknown>;

  const workDate = assertNonEmptyString(p.workDate, 'workDate');
  if (!DATE_RE.test(workDate)) {
    throw new WhatsAppValidationError('workDate must be YYYY-MM-DD');
  }

  const payload: EmployeeDailyReportWhatsAppPayload = {
    type: 'employee_daily_report',
    phone: assertNonEmptyString(p.phone, 'phone'),
    customerName: assertNonEmptyString(p.customerName, 'customerName'),
    message: assertNonEmptyString(p.message, 'message'),
    workDate,
    ledgerBalance: assertFiniteNumber(p.ledgerBalance, 'ledgerBalance'),
  };

  if (p.branchName !== undefined && typeof p.branchName === 'string')
    payload.branchName = p.branchName;
  if (p.employeeName !== undefined && typeof p.employeeName === 'string')
    payload.employeeName = p.employeeName;
  if (p.checkIn !== undefined)
    payload.checkIn = p.checkIn === null ? null : assertNonEmptyString(p.checkIn, 'checkIn');
  if (p.checkOut !== undefined)
    payload.checkOut = p.checkOut === null ? null : assertNonEmptyString(p.checkOut, 'checkOut');
  if (p.actualHours !== undefined)
    payload.actualHours = optionalFiniteNumber(p.actualHours, 'actualHours') as number | null;
  if (p.scheduledHours !== undefined)
    payload.scheduledHours = optionalFiniteNumber(p.scheduledHours, 'scheduledHours') as number | null;
  if (p.statusLabelAr !== undefined && (typeof p.statusLabelAr === 'string' || p.statusLabelAr === null))
    payload.statusLabelAr = p.statusLabelAr as string | null;
  if (p.lateMinutes !== undefined)
    payload.lateMinutes = optionalFiniteNumber(p.lateMinutes, 'lateMinutes') as number | null;
  if (p.baseWage !== undefined)
    payload.baseWage = optionalFiniteNumber(p.baseWage, 'baseWage') as number | null;
  if (p.fullDayBase !== undefined)
    payload.fullDayBase = optionalFiniteNumber(p.fullDayBase, 'fullDayBase') as number | null;
  if (p.isPartialDay !== undefined)
    payload.isPartialDay = Boolean(p.isPartialDay);
  if (p.baseWageNoteAr !== undefined && (typeof p.baseWageNoteAr === 'string' || p.baseWageNoteAr === null))
    payload.baseWageNoteAr = p.baseWageNoteAr as string | null;
  if (p.targetSales !== undefined)
    payload.targetSales = optionalFiniteNumber(p.targetSales, 'targetSales') as number | null;
  if (p.targetAmount !== undefined)
    payload.targetAmount = optionalFiniteNumber(p.targetAmount, 'targetAmount') as number | null;
  if (p.deductions !== undefined)
    payload.deductions = optionalFiniteNumber(p.deductions, 'deductions') as number | null;
  if (p.advances !== undefined)
    payload.advances = optionalFiniteNumber(p.advances, 'advances') as number | null;
  if (p.dayNet !== undefined)
    payload.dayNet = optionalFiniteNumber(p.dayNet, 'dayNet') as number | null;
  if (p.payrollMonth !== undefined && typeof p.payrollMonth === 'string')
    payload.payrollMonth = p.payrollMonth;
  if (p.variables !== undefined)
    payload.variables = validateExtraVariables(p.variables);

  return payload;
}

export function validatePayload(input: unknown): WhatsAppPayload {
  if (typeof input !== 'object' || input === null) {
    throw new WhatsAppValidationError('Payload must be an object');
  }
  const p = input as Record<string, unknown>;

  switch (p.type) {
    case 'sale':
      return validateSalePayload(input);
    case 'booking':
      return validateBookingPayload(input);
    case 'first_time':
      return validateFirstTimePayload(input);
    case 'employee_sale':
      return validateEmployeeSalePayload(input);
    case 'employee_advance':
      return validateEmployeeAdvancePayload(input);
    case 'employee_funding':
      return validateEmployeeFundingPayload(input);
    case 'quick_message':
      return validateQuickMessagePayload(input);
    case 'employee_daily_report':
      return validateEmployeeDailyReportPayload(input);
    case 'other':
      return validateOtherPayload(input);
    default:
      throw new WhatsAppValidationError(`Unknown message type: ${String(p.type)}`);
  }
}
