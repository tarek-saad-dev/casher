import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const quote = read('src/app/api/drvo/pos/quote/route.ts');
const catalog = read('src/app/api/drvo/pos/catalog/route.ts');
const employee = read('src/app/api/drvo/pos/employees/route.ts');
const proxy = read('src/proxy.ts');
const sales = read('src/app/api/drvo/pos/sales/route.ts');

const checks = [
  ['quote tenant gate', quote.includes('authorizeDrvoPosOperationalRead()')],
  ['quote server-side prices', quote.includes('p.SPrice1') && !quote.includes('data.price')],
  ['quote checks employee-service eligibility', quote.includes('EMPLOYEE_SERVICE_NOT_AVAILABLE') && quote.includes('es.IsActive = 1')],
  ['quote checks branch assignment dates', quote.includes('a.EffectiveFrom <=') && quote.includes('a.EffectiveTo IS NULL')],
  ['quote checks tenant and active location', quote.includes('e.TenantId = @tenantId') && quote.includes('l.LocationId = @locationId')],
  ['quote limits selected services', quote.includes('data.serviceIds.length > 20')],
  ['quote checks same-origin and intent', quote.includes('CSRF_DENIED') && quote.includes('x-drvo-pos-quote-intent')],
  ['catalog tenant isolation', catalog.includes('p.TenantId = @tenantId')],
  ['employees tenant isolation', employee.includes('e.TenantId = @tenantId')],
  ['staging quote allowlisted', proxy.includes("pathname === '/api/drvo/pos/quote' && req.method === 'POST'")],
  ['invoice write endpoint not allowlisted', !proxy.includes("pathname === '/api/drvo/pos/sales' && req.method === 'POST'")],
  ['invoice writes fail closed', sales.includes('POS_INVOICE_WRITES_NOT_READY')],
];
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`);
}
assert(checks.every(([, pass]) => pass), 'POS quote isolation static checks failed');
console.log('POS_QUOTE_ISOLATION_STATIC: PASS');
