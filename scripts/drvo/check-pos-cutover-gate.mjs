#!/usr/bin/env node
/**
 * Fail-closed DRVO POS cutover gate. Static checks are necessary, not sufficient:
 * do not enable legacy operational APIs until tenant/branch integration tests pass.
 * Run from repo root: node scripts/drvo/check-pos-cutover-gate.mjs
 */
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const proxy = read('src/proxy.ts');
const recent = read('src/app/api/sales/recent/route.ts');
const tenant = read('src/platform/tenant/tenantContext.ts');
const grants = read('src/platform/access/tenantGrants.ts');
const permissions = read('src/platform/access/permissions.ts');
const checks = [
  ['staging denies non-allowlisted APIs', proxy.includes('!stagingApiAllowed') && proxy.includes('Staging preview API disabled until isolation is verified')],
  ['legacy sales/recent not allowlisted in staging', !/pathname\s*===\s*['"]\/api\/sales\/recent['"]/.test(proxy)],
  ['sales/recent head query scoped to active branch', /h\.BranchID\s*=\s*@branchId/.test(recent)],
  ['sales/recent detail query scoped via invoice head and branch', /INNER JOIN\s+\[dbo\]\.\[TblinvServHead\]\s+h/.test(recent) && /h\.BranchID\s*=\s*@branchId/.test(recent)],
  ['tenant membership resolved fail closed', tenant.includes('TENANT_AMBIGUOUS') && tenant.includes('TENANT_MEMBERSHIP_MISMATCH')],
  ['branch verified within tenant', tenant.includes('assertLegacyBranchInTenant') && tenant.includes('TenantId = @tenantId AND LegacyBranchId = @branchId')],
  ['authoritative tenant grants fail closed', grants.includes('DrvoAccessDeniedError') && grants.includes('loadTenantPermissionActor')],
  ['role permission evaluator requires tenant match', permissions.includes('actor.tenantId.toLowerCase() !== resourceTenantId.toLowerCase()')],
];
let failures = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`);
  if (!pass) failures++;
}
console.log('CUTOVER_STATUS: BLOCKED_PENDING_E2E');
console.log('POS_READ_CUTOVER_ALLOWED: NO');
console.log('POS_WRITE_CUTOVER_ALLOWED: NO');
console.log('Note: static checks do not establish runtime tenant isolation or module entitlements.');
if (failures) process.exitCode = 1;
