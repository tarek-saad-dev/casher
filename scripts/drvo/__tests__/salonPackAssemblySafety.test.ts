import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SALON_PACK } from '../../../src/packs/salon/manifest';
import { resolveTenantComposition } from '../../../src/platform/apps/compositionResolver';
import { assertCanUninstall } from '../../../src/platform/apps/compositionResolver';

const source=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');

describe('Salon Pack FULL and MINIMAL assembly',()=>{
  it('assembles recommended full pack and booking+queue minimal pack without POS/payroll',()=>{
    const full=resolveTenantComposition(SALON_PACK);
    for(const app of ['booking','queue','pos','attendance','payroll','treasury','reports']){
      expect(full.apps).toContain(app);
    }
    const minimal=resolveTenantComposition(SALON_PACK,{
      remove:SALON_PACK.recommended.filter((app)=>app!=='queue'),
    });
    expect(minimal.apps).toEqual(['booking','queue']);
    expect(()=>assertCanUninstall(minimal.apps,'booking',SALON_PACK)).toThrow();
  });

  it('guards staging DB/login and cleans both disposable tenants after idempotent retry',()=>{
    const test=source('scripts/drvo/salon-pack-assembly-staging.ts');
    const workflow=source('.github/workflows/salon-pack-assembly-staging-e2e.yml');
    expect(test).toContain("const EXPECTED_DB = 'last132_agent'");
    expect(test).toContain("const EXPECTED_LOGIN = 'drvo_agent'");
    expect(test).toContain("Production DB detected; refusing to run");
    expect(test).toContain("tenants.push(req.business.tenantCode)");
    expect(test).toContain("await retryOnboardingSetup(tenantId, req, actor, deps)");
    expect(test).toContain("await purgeSmokeTenant(pool, tenantCode)");
    expect(test).toContain("name: 'FULL'");
    expect(test).toContain("name: 'MINIMAL'");
    expect(test).toContain("SALON_ASSEMBLY_E2E_STAGING_PASS");
    expect(workflow).toContain("head.ref == 'agent/salon-pack-assembly'");
    expect(workflow).toContain("environment: drvo-staging");
    expect(workflow).not.toContain('deploy-vps');
    expect(workflow).toContain('secrets.DRVO_STAGING_SSH_HOST');
    expect(workflow).toContain('secrets.DRVO_STAGING_SSH_KNOWN_HOSTS');
    expect(workflow).toContain('StrictHostKeyChecking=yes');
    expect(workflow).not.toContain('secrets.VPS_HOST');
    expect(workflow).not.toContain('ssh-keyscan');

  });
});
