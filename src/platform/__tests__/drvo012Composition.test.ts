import { describe, expect, it } from 'vitest';
import { APP_REGISTRY_CODES } from '@/platform/registry/constants';
import {
  findInstalledDependents,
  findMissingDependencies,
  getAppInstallDependencies,
  getInstallableAppCatalog,
  isInstallableAppCode,
} from '@/platform/apps/appCatalog';
import {
  assertCanInstall,
  assertCanUninstall,
  resolveTenantComposition,
  validatePackDefinition,
} from '@/platform/apps/compositionResolver';
import { TenantAppError } from '@/platform/apps/errors';
import type { IndustryPackDefinition } from '@/platform/packs/types';
import { INDUSTRY_PACKS, findIndustryPack } from '@/packs';
import { SALON_PACK } from '@/packs/salon/public';
import { SUPERMARKET_PACK } from '@/packs/supermarket/public';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TenantAppError) return err.code;
    throw err;
  }
  return undefined;
}

describe('DRVO-012 installable app catalog', () => {
  it('derives installable apps from the registry and excludes operations/platform/shared', () => {
    expect(getInstallableAppCatalog().map((a) => a.appCode)).toEqual([...APP_REGISTRY_CODES]);
    for (const code of ['operations', 'customers', 'catalog', 'workforce', 'tenant', 'rbac']) {
      expect(isInstallableAppCode(code)).toBe(false);
    }
  });

  it('encodes only the code-proven purchasing -> inventory dependency', () => {
    const withDeps = getInstallableAppCatalog().filter((a) => a.requires.length > 0);
    expect(withDeps).toEqual([{ appCode: 'purchasing', requires: ['inventory'] }]);
    expect(getAppInstallDependencies('pos')).toEqual([]);
    expect(getAppInstallDependencies('payroll')).toEqual([]);
    expect(getAppInstallDependencies('ai-receptionist')).toEqual([]);
  });

  it('finds missing dependencies and installed dependents', () => {
    expect(findMissingDependencies(['purchasing'])).toEqual([
      { appCode: 'purchasing', missing: ['inventory'] },
    ]);
    expect(findMissingDependencies(['purchasing', 'inventory'])).toEqual([]);
    expect(findInstalledDependents(['purchasing', 'inventory'], 'inventory')).toEqual(['purchasing']);
  });
});

describe('DRVO-012 industry packs', () => {
  it('every registered pack is valid against real registered apps', () => {
    for (const pack of INDUSTRY_PACKS) {
      expect(validatePackDefinition(pack), pack.packCode).toEqual({ ok: true });
    }
    expect(findIndustryPack('SALON')).toBe(SALON_PACK);
    expect(findIndustryPack('supermarket')).toBe(SUPERMARKET_PACK);
    expect(findIndustryPack('hotel')).toBeNull();
  });

  it('salon pack recommends the documented default set and keeps cut-club out of the generic recipe', () => {
    expect(resolveTenantComposition(SALON_PACK).apps).toEqual(
      ['attendance', 'booking', 'payroll', 'pos', 'queue', 'reports', 'treasury'].sort(),
    );
    expect(JSON.stringify(SALON_PACK)).not.toContain('cut-club');
  });

  it('supermarket pack resolves against registered apps only', () => {
    const resolved = resolveTenantComposition(SUPERMARKET_PACK);
    expect(resolved.apps).toEqual(['inventory', 'pos', 'purchasing', 'reports', 'treasury']);
    for (const code of resolved.apps) expect(APP_REGISTRY_CODES).toContain(code);
  });

  it('fails closed for packs referencing unknown or non-installable apps', () => {
    const bad: IndustryPackDefinition = {
      ...SUPERMARKET_PACK,
      packCode: 'broken',
      recommended: ['inventory', 'self-checkout-kiosk'],
    };
    expect(validatePackDefinition(bad).ok).toBe(false);
    expect(codeOf(() => resolveTenantComposition(bad))).toBe('PACK_INVALID');

    const withOperations: IndustryPackDefinition = {
      ...SALON_PACK,
      packCode: 'ops',
      optional: ['operations'],
    };
    expect(codeOf(() => resolveTenantComposition(withOperations))).toBe('PACK_INVALID');
  });

  it('rejects packs whose default set violates dependencies', () => {
    const bad: IndustryPackDefinition = {
      ...SUPERMARKET_PACK,
      packCode: 'nodeps',
      recommended: ['purchasing'],
      optional: [],
    };
    expect(validatePackDefinition(bad).ok).toBe(false);
  });
});

describe('DRVO-012 pack customization', () => {
  it('salon minus queue plus inventory yields exactly the requested composition', () => {
    const r = resolveTenantComposition(SALON_PACK, { remove: ['queue'], add: ['inventory'] });
    expect(r.apps).toEqual(
      ['attendance', 'booking', 'inventory', 'payroll', 'pos', 'reports', 'treasury'].sort(),
    );
    expect(r.added).toEqual(['inventory']);
    expect(r.removed).toEqual(['queue']);
    expect(r.apps).not.toContain('operations');
  });

  it('allows removing payroll and adding messaging (any installable app may be added)', () => {
    const r = resolveTenantComposition(SALON_PACK, {
      remove: ['payroll'],
      add: ['messaging', 'ai-receptionist'],
    });
    expect(r.apps).toContain('messaging');
    expect(r.apps).toContain('ai-receptionist');
    expect(r.apps).not.toContain('payroll');
  });

  it('rejects removing a pack-required app', () => {
    expect(codeOf(() => resolveTenantComposition(SALON_PACK, { remove: ['booking'] }))).toBe(
      'REQUIRED_BY_PACK',
    );
    expect(codeOf(() => resolveTenantComposition(SUPERMARKET_PACK, { remove: ['pos'] }))).toBe(
      'REQUIRED_BY_PACK',
    );
  });

  it('rejects unknown apps, conflicts and removing apps outside the default set', () => {
    expect(codeOf(() => resolveTenantComposition(SALON_PACK, { add: ['operations'] }))).toBe(
      'UNKNOWN_APP',
    );
    expect(codeOf(() => resolveTenantComposition(SALON_PACK, { add: ['nope'] }))).toBe('UNKNOWN_APP');
    expect(
      codeOf(() => resolveTenantComposition(SALON_PACK, { add: ['queue'], remove: ['queue'] })),
    ).toBe('CUSTOMIZATION_CONFLICT');
    expect(codeOf(() => resolveTenantComposition(SALON_PACK, { remove: ['loyalty'] }))).toBe(
      'APP_NOT_SELECTED',
    );
  });

  it('rejects compositions with unmet dependencies (reject policy, no auto-install)', () => {
    expect(codeOf(() => resolveTenantComposition(SALON_PACK, { add: ['purchasing'] }))).toBe(
      'MISSING_DEPENDENCIES',
    );
    expect(
      resolveTenantComposition(SALON_PACK, { add: ['purchasing', 'inventory'] }).apps,
    ).toContain('purchasing');
    expect(
      codeOf(() => resolveTenantComposition(SUPERMARKET_PACK, { remove: ['inventory'] })),
    ).toBe('MISSING_DEPENDENCIES');
  });

  it('allows the explicitly non-dependent relationships', () => {
    expect(resolveTenantComposition(SALON_PACK, { remove: ['treasury'] }).apps).toContain('pos');
    expect(resolveTenantComposition(SALON_PACK, { remove: ['attendance'] }).apps).toContain(
      'payroll',
    );
    expect(
      resolveTenantComposition(SUPERMARKET_PACK, { add: ['ai-receptionist'] }).apps,
    ).toContain('ai-receptionist');
  });
});

describe('DRVO-012 install / uninstall validation', () => {
  const installed = ['booking', 'pos', 'inventory', 'purchasing'];

  it('install rejects unknown, operations, already-installed and missing dependencies', () => {
    expect(codeOf(() => assertCanInstall(installed, 'operations'))).toBe('UNKNOWN_APP');
    expect(codeOf(() => assertCanInstall(installed, 'pos'))).toBe('APP_ALREADY_INSTALLED');
    expect(codeOf(() => assertCanInstall(['booking'], 'purchasing'))).toBe('MISSING_DEPENDENCIES');
    expect(assertCanInstall(['booking', 'inventory'], 'purchasing')).toBe('purchasing');
    expect(assertCanInstall(['booking'], 'payroll')).toBe('payroll');
  });

  it('uninstall rejects dependency-in-use, pack-required and not-installed', () => {
    expect(codeOf(() => assertCanUninstall(installed, 'inventory', SALON_PACK))).toBe(
      'DEPENDENCY_IN_USE',
    );
    expect(codeOf(() => assertCanUninstall(installed, 'booking', SALON_PACK))).toBe(
      'REQUIRED_BY_PACK',
    );
    expect(codeOf(() => assertCanUninstall(installed, 'loyalty', SALON_PACK))).toBe(
      'APP_NOT_INSTALLED',
    );
    expect(codeOf(() => assertCanUninstall(installed, 'operations', SALON_PACK))).toBe(
      'UNKNOWN_APP',
    );
    expect(assertCanUninstall(installed, 'purchasing', SALON_PACK)).toBe('purchasing');
    expect(assertCanUninstall(installed, 'booking', null)).toBe('booking');
  });
});
