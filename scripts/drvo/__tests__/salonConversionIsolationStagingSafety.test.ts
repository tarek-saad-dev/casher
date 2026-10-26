import fs from 'node:fs';import path from 'node:path';import {describe,expect,it} from 'vitest';
const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
describe('Salon conversion isolated staging safety',()=>{
it('uses only staging database, real booking and synthetic tenant cleanup',()=>{
const smoke=read('scripts/drvo/salon-conversion-isolation-staging.ts');
const workflow=read('.github/workflows/salon-conversion-isolation-staging-e2e.yml');
expect(smoke).toContain("const EXPECTED_DB = 'last132_agent'");
expect(smoke).toContain("const EXPECTED_LOGIN = 'drvo_agent'");
expect(smoke).toContain('convertBooking(fakePorts(foreignTenantId)');
expect(smoke).toContain('foreign.status === 404');
expect(smoke).toContain('sameTenant.status === 400');
expect(smoke).toContain('SALON_CONVERSION_TENANT_ISOLATION_STAGING_PASS');
expect(smoke).toContain('await purgeSmokeTenant(pool, tenantCode)');
expect(workflow).toContain("head.ref == 'agent/salon-booking-conversion-tenant-guard'");
expect(workflow).toContain('environment: drvo-staging');
expect(workflow).not.toContain('deploy-vps');
});
});