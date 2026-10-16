#!/usr/bin/env node
/**
 * DRVO operational cutover inventory (read-only, zero DB/network writes).
 * Run: node scripts/drvo/audit-operational-cutover.mjs
 * Output is a triage inventory, NOT proof of tenant isolation.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const routeRoot = join(root, 'src/app/api');
if (!existsSync(routeRoot)) {
  console.error('Run from the repository root (src/app/api not found)');
  process.exit(2);
}
const scopes = [
  { name: 'POS / sales', match: /(?:pos|invoice|income|sale|payment|shift|business.day)/i },
  { name: 'Booking / queue', match: /(?:book|queue|availability|slot)/i },
  { name: 'HR / workforce', match: /(?:employee|staff|attendance|payroll|ledger|workforce)/i },
  { name: 'Treasury / reports', match: /(?:treasury|expense|report|finance|partner)/i },
];
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() && entry.name === 'route.ts' ? [path] : [];
  });
}
const all = walk(routeRoot);
const result = scopes.map(scope => {
  const files = all.filter(file => scope.match.test(relative(routeRoot, file)));
  const routes = files.map(file => {
    const source = readFileSync(file, 'utf8');
    const route = '/api/' + relative(routeRoot, file).replace(/\\/g, '/').replace(/\/route\.ts$/, '');
    const methods = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g)].map(m => m[1]);
    return {
      route, methods,
      hasSessionReference: /getSession|requireAuth|withAuth|requireSession/.test(source),
      hasTenantReference: /TenantId|tenantId|tenantContext|requireTenantPermission/.test(source),
      hasBranchReference: /BranchID|branchId|ActiveBranch/.test(source),
      hasRawSql: /\.query\s*(?:<[^>]+>)?\s*\(/.test(source),
      writes: methods.some(method => method !== 'GET'),
    };
  });
  return {
    area: scope.name, total: routes.length,
    writes: routes.filter(r => r.writes).length,
    missingTenantMarker: routes.filter(r => !r.hasTenantReference).map(r => r.route),
    routes,
  };
});
const proxy = readFileSync(join(root, 'src/proxy.ts'), 'utf8');
const summary = {
  scannedApiRoutes: all.length,
  areas: result.map(({ area, total, writes, missingTenantMarker }) => ({
    area, total, writes, missingTenantMarkerCount: missingTenantMarker.length,
  })),
  stagingProxyBlocksLegacyMutations: proxy.includes('Staging preview API disabled until isolation is verified'),
  cutoverReady: false,
  warning: 'Static markers cannot prove authorization. No operational route should be enabled before tenant/branch scoping, module entitlement, and cross-tenant negative integration tests.',
};
console.log(JSON.stringify({ summary, areas: result }, null, 2));
