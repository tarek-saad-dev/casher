import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Issue #117 core workspace staging QA safety', () => {
  it('requires staging database identity and refuses production env before connecting', () => {
    const source = read('scripts/drvo/drvo-117-core-workspace-qa-smoke.ts');
    expect(source).toContain("const EXPECTED_DB = 'last132_agent'");
    expect(source).toContain("const EXPECTED_LOGIN = 'drvo_agent'");
    expect(source).toContain('await assertStaging(pool);');
    expect(source).toContain('PRODUCTION_DB');
    expect(source).toContain('process.env.DB_DATABASE === PRODUCTION_DB');
    expect(source).toContain('process.env.CLOUD_DB_NAME === PRODUCTION_DB');
    expect(source).not.toContain('dotenv.config');
    expect(source).toContain('purgeSmokeTenant(pool, tenantCode)');
    expect(source).toContain("Code = N'CASHER_BOOT'");
  });

  it('does not run on arbitrary PR branches or invoke production deploy workflows', () => {
    const workflow = read('.github/workflows/drvo-117-core-workspace-staging.yml');
    expect(workflow).toContain("github.event.pull_request.head.ref == 'drvo-117-core-workspace-staging-qa'");
    expect(workflow).toContain('environment: drvo-staging');
    expect(workflow).toContain('DRVO_STAGING_SSH_KEY');
    expect(workflow).not.toContain('deploy-vps');
    expect(workflow).toContain('npm run drvo-117:smoke');
  });

  it('covers workforce, workspace location, readiness providers, and cleanup proof', () => {
    const source = read('scripts/drvo/drvo-117-core-workspace-qa-smoke.ts');
    expect(source).toContain('createLegacyWorkforceDirectoryAdapter');
    expect(source).toContain('resolveStaffTenantContextForRequest');
    expect(source).toContain('enrichTenantWorkspaceWithProviders');
    expect(source).toContain('DRVO117_CORE_WORKSPACE_QA_STAGING_PASS');
    expect(source).toContain('inactive branch/location yields empty workforce roster');
    expect(source).toContain('assignment boundary');
  });
});
