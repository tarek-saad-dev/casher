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
    default:
      throw new WhatsAppValidationError(`Unknown message type: ${String(p.type)}`);
  }
}
