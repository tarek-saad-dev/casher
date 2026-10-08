/**
 * DRVO-015 static guards: request code writes master data only with an authoritative TenantId,
 * and the scoped repositories keep their tenant predicates.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { MASTER_DATA_TENANT_TABLES } from '@/platform/masterData/tables';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = walk(path.join(ROOT, 'src'));
const TABLES = MASTER_DATA_TENANT_TABLES.join('|');

describe('DRVO-015 master-data writes carry TenantId', () => {
  it('every INSERT into a master-data table names TenantId in its column list', () => {
    const insertRe = new RegExp(
      String.raw`INSERT\s+INTO\s+(?:\[?dbo\]?\.)?\[?(${TABLES})\]?\s*(\(([^)]*)\)|\$\{\s*(\w+)\s*\})`,
      'g',
    );
    const offenders: string[] = [];
    for (const file of SRC) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(insertRe)) {
        const cols = m[3];
        const dynamicVar = m[4];
        if (cols !== undefined) {
          if (!/\bTenantId\b/.test(cols)) offenders.push(`${rel(file)}: INSERT INTO ${m[1]} (${cols.trim()})`);
        } else if (dynamicVar) {
          const decl = new RegExp(String.raw`const\s+${dynamicVar}\s*=([\s\S]*?);`).exec(text)?.[1] ?? '';
          const variants = decl.match(/'\([^']*\)'/g) ?? [];
          if (!variants.length || variants.some((v) => !/\bTenantId\b/.test(v))) {
            offenders.push(`${rel(file)}: INSERT INTO ${m[1]} \${${dynamicVar}}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('DRVO-015 scoped repositories keep their tenant predicate', () => {
  const SCOPED: Record<string, RegExp[]> = {
    'src/lib/catalog/servicePackages.ts': [/p\.TenantId = @tenantId/, /i\.TenantId = @tenantId/, /pro\.TenantId = i\.TenantId/],
    'src/lib/catalog/publicPackagesCatalog.ts': [/TenantId = @tenantId/],
    'src/lib/catalog/serviceCatalog.ts': [/TenantId = @tenantId/],
    'src/lib/catalog/tenantCatalogGuards.ts': [/CatID = @catId AND TenantId = @tenantId/, /TenantId = @tenantId AND ProID IN/],
    'src/lib/client/publicClientWebsite.service.ts': [/WHERE TenantId = @tenantId AND/, /ClientID = @clientID AND TenantId = @tenantId/],
    'src/lib/client/clientPhoneLookup.ts': [/WHERE TenantId = @tenantId AND/],
    'src/lib/publicBookingHelpers.ts': [/TenantId = @tenantId AND Mobile = @mobile/],
    'src/app/api/customers/route.ts': [/WHERE TenantId = @tenantId AND/],
    'src/app/api/customers/[id]/route.ts': [/ClientID = @clientID AND TenantId = @tenantId/],
    'src/app/api/services/route.ts': [/p\.TenantId = @tenantId/],
    'src/app/api/services/[id]/route.ts': [/ProID = @ProID AND TenantId = @tenantId/],
    'src/app/api/services/categories/[id]/route.ts': [/CatID = @CatID AND TenantId = @tenantId/],
    'src/app/api/finance/categories/[id]/route.ts': [/TenantId = @tenantId/],
    'src/app/api/payment-methods/route.ts': [/TenantId = @tenantId/],
    'src/platform/masterData/financeCategories.ts': [/TenantId = @tenantId AND CatName = @catName/],
  };

  for (const [file, patterns] of Object.entries(SCOPED)) {
    it(file, () => {
      const text = read(file);
      for (const re of patterns) expect(text, `${file} ${re}`).toMatch(re);
    });
  }

  it('no master-data repository falls back to a default tenant', () => {
    for (const file of Object.keys(SCOPED)) {
      expect(read(file), file).not.toMatch(/resolveBootstrapTenantId|BOOTSTRAP_TENANT_CODE|CASHER_BOOT/);
    }
  });

  it('provisionTenant seeds master data through seedTenantMasterData only', () => {
    const text = read('src/platform/onboarding/provisionTenant.ts');
    expect(text).toMatch(/seedTenantMasterData\(tx, tenantId\)/);
    expect(text).not.toMatch(/INSERT\s+INTO\s+(?:dbo\.)?(TblClient|TblPro|TblCat|TblPaymentMethods|TblExpINCat)\b/);
  });
});
