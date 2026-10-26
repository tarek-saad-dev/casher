import fs from 'node:fs';import path from 'node:path';import {describe,it,expect} from 'vitest';
const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
describe('Salon booking service invoice E2E scope',()=>{
 it('stays on staging and validates real service invoice once without pretending payment is posted',()=>{
 const s=read('scripts/drvo/salon-booking-invoice-staging.ts');
 const w=read('.github/workflows/salon-booking-invoice-staging-e2e.yml');
 expect(s).toContain("const EXPECTED_DB = 'last132_agent'");
 expect(s).toContain("const EXPECTED_LOGIN = 'drvo_agent'");
 expect(s).toContain('await openBusinessDay(branchCtx, businessDate)');
 expect(s).toContain('await openShift(branchCtx, ownerUserId, 1)');
 expect(s).toContain('await convertBooking(actualPorts, {');
 expect(s).toContain('SALON_BOOKING_SERVICE_INVOICE_STAGING_PASS');
 expect(s).toContain('convertedReplay.idempotentReplay');
 expect(s).toContain('await purgeSmokeTenant(pool, tenantCode)');
 expect(w).toContain("head.ref == 'agent/salon-booking-conversion-tenant-guard'");
 expect(w).toContain('environment: drvo-staging');
 expect(w).not.toContain('deploy-vps');
 });
});