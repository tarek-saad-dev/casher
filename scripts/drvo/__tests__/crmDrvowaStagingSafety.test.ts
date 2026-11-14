import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('CRM DRVOWA staging gate safety', () => {
  it('locks verification to last132_agent / drvo_agent and refuses production DB', () => {
    const source = read('scripts/drvo/crm-drvowa-staging-verify.ts');
    expect(source).toContain("const EXPECTED_DB = 'last132_agent'");
    expect(source).toContain("const EXPECTED_LOGIN = 'drvo_agent'");
    expect(source).toContain('assertStaging(pool)');
    expect(source).toContain("=== 'last132'");
    expect(source).not.toContain('dotenv.config');
    expect(source).toContain('mutatedOperationalTables: false');
    expect(source).toContain('identitySweep');
    expect(source).toContain('statusSweep');
  });

  it('checks out exact PR head SHA and never substitutes production SSH key', () => {
    const workflow = read('.github/workflows/crm-drvowa-staging-gate.yml');
    expect(workflow).toContain("github.event.pull_request.head.ref == 'feature/crm-drvowa-connector-tools'");
    expect(workflow).toContain('ref: ${{ steps.sha.outputs.ref }}');
    expect(workflow).toContain('environment: drvo-staging');
    expect(workflow).toContain('DRVO_STAGING_SSH_KEY');
    expect(workflow).toContain('DRVO_STAGING_DB_PASSWORD');
    expect(workflow).toContain('DRVO_STAGING_SSH_KEY must not equal VPS_SSH_KEY');
    expect(workflow).not.toContain('deploy-vps');
    expect(workflow).not.toContain('VPS_SSH_KEY:');
    expect(workflow).toContain('npx tsx scripts/drvo/crm-drvowa-staging-verify.ts');
    expect(workflow).toContain('DB_DATABASE: last132_agent');
    expect(workflow).toContain('DB_USER: drvo_agent');
  });

  it('advertises customer/catalog identitySweep and invoice statusSweep in the manifest', () => {
    const manifest = read('src/modules/integrations/drvowa/manifest.ts');
    expect(manifest).toContain('identitySweep');
    expect(manifest).toContain('identitySweepSinceClientId');
    expect(manifest).toContain('identitySweepSinceProId');
    expect(manifest).toContain('statusSweep');
  });
});
