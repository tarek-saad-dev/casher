import type { DrvowaInvoiceStatus } from './types';

export const DRVOWA_PAGE_LIMIT_DEFAULT = 100;
export const DRVOWA_PAGE_LIMIT_MAX = 200;

export function clampPageLimit(
  value: unknown,
  fallback: number = DRVOWA_PAGE_LIMIT_DEFAULT,
): number {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new DrvowaValidationError('INVALID_LIMIT', 'limit must be a positive integer');
  }
  return Math.min(n, DRVOWA_PAGE_LIMIT_MAX);
}

export function parseOptionalNonNegativeInt(
  value: unknown,
  field: string,
): number {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new DrvowaValidationError(
      'INVALID_CURSOR',
      `${field} must be a non-negative integer`,
    );
  }
  return n;
}

export function parseOptionalBoolean(
  value: unknown,
  fallback = false,
): boolean {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  throw new DrvowaValidationError('INVALID_BOOLEAN', 'boolean field is invalid');
}

/**
 * Cut Salon / Cashier legacy: isActive='yes' means cancelled/voided.
 * Active (valid) sales use ISNULL(isActive,'no') = 'no'.
 */
export function mapInvoiceSaleStatus(
  isActive: string | null | undefined,
): DrvowaInvoiceStatus {
  const normalized = String(isActive ?? 'no').trim().toLowerCase();
  return normalized === 'yes' ? 'cancelled' : 'active';
}

export function isValidSaleIsActive(isActive: string | null | undefined): boolean {
  return mapInvoiceSaleStatus(isActive) === 'active';
}

export class DrvowaValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DrvowaValidationError';
    this.code = code;
  }
}
