import { describe, expect, it } from 'vitest';
import {
  getPublicSignupAppChoices,
  PublicSignupAppSelectionError,
  resolvePublicSignupAppSelection,
} from '@/platform/publicSignup/appSelection';

function codeOf(action: () => unknown): string | null {
  try { action(); } catch (err) {
    if (err instanceof PublicSignupAppSelectionError) return err.code;
    throw err;
  }
  return null;
}

describe('public signup app selection contract', () => {
  it('derives defaults and available choices from existing industry packs', () => {
    const salon = getPublicSignupAppChoices('salon');
    expect(salon.packCode).toBe('salon');
    expect(salon.defaults).toEqual(['booking', 'queue', 'pos', 'attendance', 'payroll', 'treasury', 'reports']);
    expect(salon.apps.find((app) => app.code === 'booking')?.group).toBe('required');
    expect(salon.apps.find((app) => app.code === 'purchasing')?.requires).toEqual(['inventory']);
    expect(salon.apps.map((app) => app.code)).not.toContain('messaging');
    expect(salon.apps.map((app) => app.code)).not.toContain('ai-receptionist');
    const market = getPublicSignupAppChoices('supermarket');
    expect(market.defaults).toEqual(['pos', 'inventory', 'purchasing', 'treasury', 'reports']);
    expect(market.apps.find((app) => app.code === 'pos')?.group).toBe('required');
  });

  it('preserves pack defaults when selected and allows custom additions and removals', () => {
    const salon = getPublicSignupAppChoices('salon');
    expect(resolvePublicSignupAppSelection('salon', salon.defaults).customizations)
      .toEqual({ add: [], remove: [] });
    const selection = resolvePublicSignupAppSelection('salon', ['booking', 'pos', 'inventory', 'purchasing']);
    expect(selection.apps).toEqual(['booking', 'inventory', 'pos', 'purchasing']);
    expect(selection.customizations).toEqual({
      add: ['inventory', 'purchasing'],
      remove: ['queue', 'attendance', 'payroll', 'treasury', 'reports'],
    });
  });

  it('rejects a removed required app and unknown or not-yet-public products', () => {
    expect(codeOf(() => resolvePublicSignupAppSelection('salon', ['pos']))).toBe('REQUIRED_BY_PACK');
    expect(codeOf(() => resolvePublicSignupAppSelection('salon', ['booking', 'ai-receptionist']))).toBe('APP_NOT_AVAILABLE');
    expect(codeOf(() => resolvePublicSignupAppSelection('supermarket', ['pos', 'loyalty']))).toBe('APP_NOT_AVAILABLE');
    expect(codeOf(() => resolvePublicSignupAppSelection('salon', ['booking', 'operations']))).toBe('APP_NOT_AVAILABLE');
    expect(codeOf(() => resolvePublicSignupAppSelection('unknown', []))).toBe('INDUSTRY_INVALID');
  });

  it('fails closed on malformed choices, duplicates and missing dependencies', () => {
    expect(codeOf(() => resolvePublicSignupAppSelection('salon', 'booking'))).toBe('APP_SELECTION_INVALID');
    expect(codeOf(() => resolvePublicSignupAppSelection('salon', ['booking', 'booking']))).toBe('APP_SELECTION_INVALID');
    expect(codeOf(() => resolvePublicSignupAppSelection('salon', ['booking', 'purchasing']))).toBe('MISSING_DEPENDENCIES');
    expect(codeOf(() => resolvePublicSignupAppSelection('supermarket', ['pos', 'purchasing']))).toBe('MISSING_DEPENDENCIES');
    expect(resolvePublicSignupAppSelection('supermarket', ['pos', 'inventory', 'purchasing']).apps)
      .toEqual(['inventory', 'pos', 'purchasing']);
  });
});
