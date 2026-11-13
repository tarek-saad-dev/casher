import { describe, expect, it } from 'vitest';
import {
  clampPageLimit,
  DRVOWA_PAGE_LIMIT_MAX,
  DrvowaValidationError,
  isValidSaleIsActive,
  mapInvoiceSaleStatus,
  parseOptionalBoolean,
  parseOptionalNonNegativeInt,
} from '../validate';
import {
  getDrvowaCrmSyncToolDefinitions,
  listImplementedDrvowaCrmTools,
} from '../index';

describe('drvowa CRM sync validate + manifest', () => {
  it('maps legacy isActive sale status', () => {
    expect(mapInvoiceSaleStatus(null)).toBe('active');
    expect(mapInvoiceSaleStatus(undefined)).toBe('active');
    expect(mapInvoiceSaleStatus('no')).toBe('active');
    expect(mapInvoiceSaleStatus('NO')).toBe('active');
    expect(mapInvoiceSaleStatus('yes')).toBe('cancelled');
    expect(mapInvoiceSaleStatus('YES')).toBe('cancelled');
    expect(isValidSaleIsActive('no')).toBe(true);
    expect(isValidSaleIsActive('yes')).toBe(false);
  });

  it('clamps page limit to max 200', () => {
    expect(clampPageLimit(undefined)).toBe(100);
    expect(clampPageLimit(50)).toBe(50);
    expect(clampPageLimit(500)).toBe(DRVOWA_PAGE_LIMIT_MAX);
    expect(() => clampPageLimit(0)).toThrow(DrvowaValidationError);
    expect(() => clampPageLimit(-1)).toThrow(DrvowaValidationError);
    expect(() => clampPageLimit(1.5)).toThrow(DrvowaValidationError);
  });

  it('parses cursor integers and booleans', () => {
    expect(parseOptionalNonNegativeInt(undefined, 'sinceClientId')).toBe(0);
    expect(parseOptionalNonNegativeInt(12, 'sinceClientId')).toBe(12);
    expect(() => parseOptionalNonNegativeInt(-1, 'sinceClientId')).toThrow(
      DrvowaValidationError,
    );
    expect(parseOptionalBoolean(undefined, false)).toBe(false);
    expect(parseOptionalBoolean(true)).toBe(true);
    expect(parseOptionalBoolean('yes')).toBe(true);
    expect(parseOptionalBoolean('no')).toBe(false);
  });

  it('exposes CRM sync tools with invoice includeInactive cursor docs', () => {
    const tools = getDrvowaCrmSyncToolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'customer.list_changes',
      'invoice.list_changes',
      'catalog.list_services',
    ]);
    expect(listImplementedDrvowaCrmTools()).toEqual(names);

    const invoice = tools.find((t) => t.name === 'invoice.list_changes');
    expect(invoice?.description).toMatch(/includeInactive=true/i);
    expect(invoice?.description).toMatch(/append-only/i);
    expect(invoice?.inputSchema?.properties).toHaveProperty('includeInactive');
  });
});
