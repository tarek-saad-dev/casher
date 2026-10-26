import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SALON_PACK } from '../../../src/packs/salon/manifest';
import { APP_REGISTRY_CODES, OPERATIONS_SURFACE_CODE } from '../../../src/platform/registry/constants';
import { validatePackDefinition, resolveTenantComposition } from '../../../src/platform/apps/compositionResolver';
import { isLegacyOnlyAppCode, getAppInstallDependencies } from '../../../src/platform/apps/appCatalog';

const audit = () => fs.readFileSync(path.join(process.cwd(),'docs/drvo/SALON-PACK-AGENT2-ARCHITECTURE-AUDIT.md'),'utf8');

describe('Salon architecture baseline contract', () => {
  it('keeps the salon industry pack valid and operations as a composition surface', () => {
    expect(validatePackDefinition(SALON_PACK)).toEqual({ ok: true });
    expect(SALON_PACK.required).toContain('booking');
    expect(APP_REGISTRY_CODES).not.toContain(OPERATIONS_SURFACE_CODE);
    const full = resolveTenantComposition(SALON_PACK);
    expect(full.apps).toContain('booking');
    expect(full.apps).toContain('pos');
    expect(full.apps).toContain('queue');
    expect(full.apps.every((code) => !isLegacyOnlyAppCode(code))).toBe(true);
  });

  it('can resolve a minimal booking and queue pack without POS or payroll', () => {
    const excluded = SALON_PACK.recommended.filter((app) => app !== 'queue');
    const composition = resolveTenantComposition(SALON_PACK, { remove: excluded });
    expect(composition.apps).toEqual(['booking','queue']);
  });

  it('documents actual hard dependencies distinctly from runtime coupling', () => {
    expect(getAppInstallDependencies('purchasing')).toContain('inventory');
    const text = audit();
    expect(text).toContain('A-01');
    expect(text).toContain('A-08');
    expect(text).toContain('issue #148');
    expect(text).toContain('Platform Outbox');
    expect(text).toContain('Not accepted');
  });
});
