import type { AppRegistryCode } from '@/platform/registry/constants';
import type { AppCustomizations, IndustryPackDefinition } from '@/platform/packs/types';
import {
  findInstalledDependents,
  findMissingDependencies,
  isInstallableAppCode,
  isLegacyOnlyAppCode,
} from './appCatalog';
import { TenantAppError } from './errors';

export type PackValidationResult = { ok: true } | { ok: false; failures: string[] };

/** Fail-closed pack validation against the installable catalog. */
export function validatePackDefinition(pack: IndustryPackDefinition): PackValidationResult {
  const failures: string[] = [];
  if (!pack.packCode || pack.packCode !== pack.packCode.trim().toLowerCase()) {
    failures.push(`packCode must be lowercase and trimmed: "${pack.packCode}"`);
  }
  if (!Number.isInteger(pack.version) || pack.version < 1) {
    failures.push(`pack ${pack.packCode} version must be a positive integer`);
  }

  const seen = new Map<string, string>();
  for (const [list, codes] of [
    ['required', pack.required],
    ['recommended', pack.recommended],
    ['optional', pack.optional],
  ] as const) {
    for (const code of codes) {
      if (!isInstallableAppCode(code)) {
        failures.push(`pack ${pack.packCode} ${list} references non-installable app "${code}"`);
      } else if (isLegacyOnlyAppCode(code)) {
        failures.push(`pack ${pack.packCode} ${list} references legacy-only app "${code}"`);
      }
      const prior = seen.get(code);
      if (prior) {
        failures.push(`pack ${pack.packCode} lists "${code}" in both ${prior} and ${list}`);
      }
      seen.set(code, list);
    }
  }

  const defaults = [...pack.required, ...pack.recommended];
  for (const gap of findMissingDependencies(defaults)) {
    failures.push(
      `pack ${pack.packCode} default set has ${gap.appCode} without ${gap.missing.join(', ')}`,
    );
  }
  return failures.length ? { ok: false, failures } : { ok: true };
}

export function assertPackDefinitionValid(pack: IndustryPackDefinition): void {
  const result = validatePackDefinition(pack);
  if (!result.ok) {
    throw new TenantAppError('PACK_INVALID', result.failures.join('; '), 400, {
      packCode: pack.packCode,
      failures: result.failures,
    });
  }
}

function normalizeCodes(codes: readonly string[] | undefined): string[] {
  return [...new Set((codes ?? []).map((c) => String(c).trim().toLowerCase()).filter(Boolean))];
}

export type ResolvedComposition = {
  packCode: string;
  packVersion: number;
  apps: AppRegistryCode[];
  added: AppRegistryCode[];
  removed: AppRegistryCode[];
};

/**
 * Final installed-app set = pack defaults (required + recommended) + add − remove.
 * Any installable app may be added. Required pack apps cannot be removed.
 * Dependencies must be satisfied by the final set (reject policy, no auto-install).
 */
export function resolveTenantComposition(
  pack: IndustryPackDefinition,
  customizations: AppCustomizations = {},
): ResolvedComposition {
  assertPackDefinitionValid(pack);
  const add = normalizeCodes(customizations.add);
  const remove = normalizeCodes(customizations.remove);

  const unknown = [...add, ...remove].filter((c) => !isInstallableAppCode(c));
  if (unknown.length) {
    throw new TenantAppError('UNKNOWN_APP', `Unknown or non-installable app(s): ${unknown.join(', ')}`, 400, {
      apps: unknown,
    });
  }

  const legacyOnly = add.filter(isLegacyOnlyAppCode);
  if (legacyOnly.length) {
    throw new TenantAppError(
      'APP_NOT_AVAILABLE',
      `App(s) not available for new tenants in V1: ${legacyOnly.join(', ')}`,
      400,
      { apps: legacyOnly },
    );
  }

  const conflict = add.filter((c) => remove.includes(c));
  if (conflict.length) {
    throw new TenantAppError(
      'CUSTOMIZATION_CONFLICT',
      `App(s) both added and removed: ${conflict.join(', ')}`,
      400,
      { apps: conflict },
    );
  }

  const requiredRemoved = remove.filter((c) => pack.required.includes(c));
  if (requiredRemoved.length) {
    throw new TenantAppError(
      'REQUIRED_BY_PACK',
      `App(s) required by pack ${pack.packCode} cannot be removed: ${requiredRemoved.join(', ')}`,
      400,
      { apps: requiredRemoved, packCode: pack.packCode },
    );
  }

  const defaults = new Set<string>([...pack.required, ...pack.recommended]);
  const notSelected = remove.filter((c) => !defaults.has(c));
  if (notSelected.length) {
    throw new TenantAppError(
      'APP_NOT_SELECTED',
      `Cannot remove app(s) not in the pack default set: ${notSelected.join(', ')}`,
      400,
      { apps: notSelected },
    );
  }

  const final = new Set<string>(defaults);
  for (const c of add) final.add(c);
  for (const c of remove) final.delete(c);

  const missing = findMissingDependencies(final);
  if (missing.length) {
    throw new TenantAppError(
      'MISSING_DEPENDENCIES',
      missing.map((m) => `${m.appCode} requires ${m.missing.join(', ')}`).join('; '),
      400,
      { missing },
    );
  }

  const apps = [...final].filter(isInstallableAppCode).sort();
  return {
    packCode: pack.packCode,
    packVersion: pack.version,
    apps,
    added: add.filter((c) => !defaults.has(c)).filter(isInstallableAppCode).sort(),
    removed: remove.filter(isInstallableAppCode).sort(),
  };
}

/** Validate a single install against the current installed set. */
export function assertCanInstall(installed: Iterable<string>, code: string): AppRegistryCode {
  const normalized = String(code).trim().toLowerCase();
  if (!isInstallableAppCode(normalized)) {
    throw new TenantAppError('UNKNOWN_APP', `Unknown or non-installable app: ${code}`, 400, {
      apps: [code],
    });
  }
  if (isLegacyOnlyAppCode(normalized)) {
    throw new TenantAppError('APP_NOT_AVAILABLE', `App not available for new tenants in V1: ${normalized}`, 400, {
      apps: [normalized],
    });
  }
  const set = new Set(installed);
  if (set.has(normalized)) {
    throw new TenantAppError('APP_ALREADY_INSTALLED', `App already installed: ${normalized}`, 409);
  }
  set.add(normalized);
  const missing = findMissingDependencies(set).filter((m) => m.appCode === normalized);
  if (missing.length) {
    throw new TenantAppError(
      'MISSING_DEPENDENCIES',
      `${normalized} requires ${missing[0]!.missing.join(', ')}`,
      400,
      { missing },
    );
  }
  return normalized;
}

/** Validate a single uninstall against the current installed set and pack. */
export function assertCanUninstall(
  installed: Iterable<string>,
  code: string,
  pack: Pick<IndustryPackDefinition, 'packCode' | 'required'> | null,
): AppRegistryCode {
  const normalized = String(code).trim().toLowerCase();
  if (!isInstallableAppCode(normalized)) {
    throw new TenantAppError('UNKNOWN_APP', `Unknown or non-installable app: ${code}`, 400, {
      apps: [code],
    });
  }
  const set = new Set(installed);
  if (!set.has(normalized)) {
    throw new TenantAppError('APP_NOT_INSTALLED', `App is not installed: ${normalized}`, 409);
  }
  if (pack && pack.required.includes(normalized)) {
    throw new TenantAppError(
      'REQUIRED_BY_PACK',
      `${normalized} is required by pack ${pack.packCode}`,
      400,
      { packCode: pack.packCode },
    );
  }
  const dependents = findInstalledDependents(set, normalized);
  if (dependents.length) {
    throw new TenantAppError(
      'DEPENDENCY_IN_USE',
      `${normalized} is required by installed app(s): ${dependents.join(', ')}`,
      400,
      { dependents },
    );
  }
  return normalized;
}
