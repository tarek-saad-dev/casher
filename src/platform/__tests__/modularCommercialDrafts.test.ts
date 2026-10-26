import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRVO_MIGRATIONS } from '../../../scripts/drvo/migrations/index';
import { checksumFile } from '../../../scripts/drvo/checksum';
import { readSqlBatches } from '../../../scripts/drvo/sqlBatch';
import { evaluateModularDraftShadow } from '@/platform/commercial/modularDraftShadow';

const sqlPath = path.join(process.cwd(), 'db/drvo-migrations/015-modular-commercial-drafts/schema.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const executable = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
const base = {
  tenantId:'11111111-1111-4111-8111-111111111111',
  catalogStatus:'draft' as const, catalogIndustry:'salon', tenantIndustry:'salon',
  requiredApps:['booking'], selectedApps:['booking','pos'],
  installedApps:['booking','pos'],
  subscriptionStatus:'trial' as const,
};

describe('DRVO 015 modular commercial schema safety', () => {
  it('registers migration 15 with its file checksum and additive controls', () => {
    const mig = DRVO_MIGRATIONS.find(x=>x.migrationKey==='modular-commercial-drafts');
    expect(mig).toMatchObject({migrationId:15,dependencies:['commercial-subscription-tenant-apps','tenant-plan-requests']});
    expect(mig?.checksum).toBe(checksumFile(sqlPath));
    expect(mig?.control).toMatchObject({kind:'schema',risk:'LOW',lockProfile:'short'});
  });
  it('is one transactional idempotent additive batch and does not overwrite existing subscribers', () => {
    expect(readSqlBatches(sqlPath)).toHaveLength(1);
    expect(executable).toContain('SET XACT_ABORT ON');
    expect(executable).toContain('BEGIN TRAN');
    expect(executable).toContain('ROLLBACK TRAN');
    for(const table of ['ModularPriceCatalog','ModularPriceCatalogItem','TenantModularDraft','TenantModularDraftApp']){
      expect(executable).toContain("IF OBJECT_ID(N'dbo."+table+"', N'U') IS NULL");
    }
    expect(executable).not.toMatch(/\b(?:DROP|TRUNCATE|MERGE|UPDATE|DELETE)\b/i);
    expect(executable).not.toMatch(/\bINSERT\s+INTO\b/i);
    for(const legacy of ['SaaSPlan','TenantSubscription','TenantAppEntitlement']){
      expect(executable).not.toContain('ALTER TABLE dbo.'+legacy);
    }
  });
  it('uses tenant-scoped draft keys, nonpayable statuses and integer minor-unit catalog prices', () => {
    expect(executable).toContain('FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId)');
    expect(executable).toContain('UX_TenantModularDraft_CurrentTenant');
    expect(executable).toContain("Status IN (N'draft', N'void')");
    expect(executable).toContain('MonthlyMinor BIGINT NOT NULL');
    expect(executable).toContain('CHECK (MonthlyMinor >= 0)');
    expect(executable).not.toMatch(/status\s+in\s*\([^)]*N'active'/i);
  });
});

describe('modular draft shadow evaluator never grants access or claims payment', () => {
  it('keeps matching draft merely informational without approved catalog', () => {
    expect(evaluateModularDraftShadow(base)).toMatchObject({
      mode:'shadow_only',canCharge:false,canActivate:false,grantsEntitlements:false,
      changesLegacySubscription:false,readiness:'catalog_not_approved',issues:[],
    });
  });
  it('does not grant access even if catalog is approved and subscription is active', () => {
    expect(evaluateModularDraftShadow({...base,catalogStatus:'approved',subscriptionStatus:'active'})).toMatchObject({
      readiness:'valid_draft',canActivate:false,canCharge:false,grantsEntitlements:false,
    });
  });
  it('detects missing dependency, prohibited apps, installed/draft divergence and duplicate apps', () => {
    const result=evaluateModularDraftShadow({...base,selectedApps:['booking','purchasing','purchasing','messaging']});
    expect(result.issues).toContain('APP_NOT_ELIGIBLE:messaging');
    expect(result.issues).toContain('DUPLICATE_APP:purchasing');
    expect(result.issues).toContain('DEPENDENCY_MISSING:purchasing:inventory');
    expect(result.readiness).toBe('invalid_selection');
  });
  it('does not treat an installed app as payment and rejects an incomplete required set', () => {
    const result=evaluateModularDraftShadow({...base,selectedApps:['pos'],subscriptionStatus:'active'});
    expect(result.issues).toContain('REQUIRED_APP_MISSING:booking');
    expect(result.canCharge).toBe(false);
    expect(result.changesLegacySubscription).toBe(false);
  });
});
