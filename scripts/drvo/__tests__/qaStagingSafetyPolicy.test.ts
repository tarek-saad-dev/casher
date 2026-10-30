/** QA staging policy: static-only, never connects to SQL. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/drvo-staging-gate.yml', 'utf8');
const smoke = readFileSync('scripts/drvo/drvo-013-tenant-isolation-smoke.ts', 'utf8');

describe('QA staging-only safety policy', () => {
  it('requires staging identity checks in workflow', () => {
    expect(workflow).toContain('DB_DATABASE: last132_agent');
    expect(workflow).toContain('DB_USER: drvo_agent');
    expect(workflow).toContain('Prove staging identity');
    expect(workflow).toContain("row.db !== 'last132_agent'");
  });
  it('never uses production VPS host as staging SSH fallback', () => {
    expect(workflow).not.toContain('secrets.DRVO_STAGING_SSH_HOST || secrets.VPS_HOST');
  });
  it('guards actual smoke database and SQL login', () => {
    expect(smoke).toContain("const STAGING_DB = 'last132_agent'");
    expect(smoke).toContain("const STAGING_LOGIN = 'drvo_agent'");
    expect(smoke).toContain('if (liveDb === PRODUCTION_DB)');
    expect(smoke).toContain('await assertLiveDatabase(pool)');
  });
});
