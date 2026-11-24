import { describe, expect, it } from 'vitest';
import { normalizeMoneyText, parseMoney } from '@/components/ui/money-input';

describe('MoneyInput normalization', () => {
  it('accepts Arabic-Indic and Persian digits', () => {
    expect(normalizeMoneyText('١٢٣')).toBe('123');
    expect(normalizeMoneyText('۴۵۶')).toBe('456');
  });

  it('drops thousands marks and maps the Arabic decimal mark', () => {
    expect(normalizeMoneyText('١٬٢٣٤٫٥')).toBe('1234.5');
    expect(normalizeMoneyText('1,234.50')).toBe('1234.50');
  });

  it('keeps one decimal point and at most two decimals', () => {
    expect(normalizeMoneyText('12.3.4')).toBe('12.34');
    expect(normalizeMoneyText('9.999')).toBe('9.99');
    expect(normalizeMoneyText('7.5', 0)).toBe('7');
  });

  it('strips letters and signs', () => {
    expect(normalizeMoneyText('EGP 50-')).toBe('50');
  });

  it('parses to number or null', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('.')).toBeNull();
    expect(parseMoney('12.5')).toBe(12.5);
  });
});
