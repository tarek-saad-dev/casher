/**
 * DRVO-013 — static guards against regressions to default-tenant / global-scope patterns.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const contents = new Map<string, string>();
const read = (rel: string) => {
  let text = contents.get(rel);
  if (text === undefined) {
    text = fs.readFileSync(path.join(root, rel), 'utf8');
    contents.set(rel, text);
  }
  return text;
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

const SOURCES = [...walk('src'), ...walk('scripts')];

function filesMatching(re: RegExp): string[] {
  return SOURCES.filter((f) => re.test(read(f))).sort();
}

describe('DRVO-013 no default / first tenant', { timeout: 120_000 }, () => {
  it('the bootstrap tenant is only resolved through named CASHER_BOOT seams', () => {
    expect(filesMatching(/resolveLegacyBootstrapTenantId\(/)).toEqual(
      [
        'scripts/drvo-007-treasury-staging-smoke.ts',
        'scripts/drvo-009-pos-sale-treasury-staging-smoke.ts',
        'scripts/drvo/drvo-013-tenant-isolation-smoke.ts',
        'scripts/drvo/drvo-015-master-data-smoke.ts',
        'scripts/messaging-outbox-worker.ts',
        'scripts/provision-camp-caesar-setup.ts',
        'scripts/verify-and-heal-payroll-days.ts',
        // platform-operator-tenant: operator maintenance over CASHER_BOOT's catalog
        'src/app/api/admin/seed-service-image-paths/route.ts',
        // legacy-messaging-worker + legacy-payroll-job-log: CASHER_BOOT-only legacy tables
        'src/app/api/admin/hr/nightly-close/route.ts',
        // legacy-payroll-job-log: TblAutoGenLog has no TenantId
        'src/app/api/payroll/daily/auto-generate/route.ts',
        // platform-operator-tenant + legacy-global-data
        'src/lib/api-auth.ts',
        'src/modules/messaging/ai/tools/getCustomerContext.ts',
        'src/platform/tenant/legacyBootstrapSeam.ts',
      ].sort(),
    );
  });

  it('every named seam is documented with the reason its data has no TenantId', async () => {
    const src = read('src/platform/tenant/legacyBootstrapSeam.ts');
    for (const seam of [
      'platform-operator-tenant',
      'legacy-messaging-worker',
      'legacy-global-data',
      'legacy-payroll-job-log',
      'casher-boot-staging-smoke',
      'casher-boot-operator-script',
    ]) {
      expect(src).toContain(`'${seam}':`);
    }
  });

  it('request code never defines or calls a bootstrap-tenant default', () => {
    const offenders = filesMatching(/resolveBootstrapTenantId/).filter((f) => !f.startsWith('scripts/'));
    expect(offenders).toEqual([]);
  });

  it('BOOTSTRAP_TENANT_CODE is confined to the seam, the guard and bootstrap scripts', () => {
    expect(filesMatching(/BOOTSTRAP_TENANT_CODE/).filter((f) => f.startsWith('src/'))).toEqual(
      [
        'src/platform/commercial/bootstrapGuard.ts',
        'src/platform/public/index.ts',
        'src/platform/tenant/legacyBootstrapSeam.ts',
        'src/platform/tenant/types.ts',
      ].sort(),
    );
  });

  it('nothing selects an arbitrary first tenant', () => {
    expect(filesMatching(/TOP\s*\(?\s*1\s*\)?\s+\w*\.?TenantId\s+FROM\s+dbo\.Tenant\b/i)).toEqual([]);
  });
});

/**
 * Every sp_getapplock site must be classified. Tenant-scoped sites build their resource with
 * tenantLockResource; global sites lock identities that are globally unique by construction.
 */
const APPLOCK_INVENTORY: Record<string, string> = {
  'src/platform/tenant/tenantApplock.ts': 'tenant: tenantLockResource(tenantId, parts)',
  'src/shared/workforce/internal/legacyAdapter.ts': 'tenant: tenantLockResource(tenantId, booking:emp:...)',
  'src/lib/booking/publicBookingCreateLocks.ts':
    'global-by-design: EmpID / BookingCode are globally unique; any-barber locks key on globally unique LocationId',
  'src/modules/attendance/infra/legacyBranchAttendance.ts': 'global-by-design: EmpID is globally unique',
  'src/modules/attendance/infra/AttendanceRepository.ts': 'global-by-design: EmpID is globally unique',
  'src/lib/scheduleIntegrity.ts': 'global-by-design: EmpID is globally unique',
  'src/lib/hr/attendance/autoAbsence.ts': 'global-by-design: single legacy scan job (CASHER_BOOT data)',
  'src/lib/db.ts': 'global-by-design: legacy invID allocator over global legacy tables',
};

describe('DRVO-013 applock inventory', () => {
  it('every sp_getapplock call site is classified', () => {
    const sites = filesMatching(/EXEC\s+@\w+\s*=\s*sp_getapplock/i).filter((f) => f.startsWith('src/'));
    expect(sites).toEqual(Object.keys(APPLOCK_INVENTORY).sort());
  });

  it('tenant-classified sites build their resource through tenantLockResource', () => {
    for (const [file, cls] of Object.entries(APPLOCK_INVENTORY)) {
      if (cls.startsWith('tenant:')) expect(read(file), file).toContain('tenantLockResource(');
    }
  });
});

describe('DRVO-013 control plane vs staff context', () => {
  const platformRoutes = SOURCES.filter((f) => /^src\/app\/api\/admin\/platform\/.*route\.ts$/.test(f));

  it('platform routes exist and every one uses requirePlatformOperator only', () => {
    expect(platformRoutes.length).toBeGreaterThan(0);
    for (const f of platformRoutes) {
      const src = read(f);
      expect(src, f).toContain('requirePlatformOperator(');
      expect(src, f).not.toMatch(/\b(authenticate|requireAdmin|requireRole|requireSession)\(/);
    }
  });

  it('booking / queue / pos composition roots gate on the authoritative tenant', () => {
    for (const [file, app] of [
      ['src/lib/bookingSchedulingComposition.ts', 'booking'],
      ['src/lib/queueSchedulingComposition.ts', 'queue'],
      ['src/lib/posComposition.ts', 'pos'],
    ] as const) {
      const src = read(file);
      expect(src, file).toContain(`assertTenantAppInstalled(tenantId, '${app}')`);
      expect(src, file).toContain('requireActorTenantId(');
    }
  });

  it('the signed session requires a tenant binding', () => {
    const src = read('src/lib/session.ts');
    expect(src).toContain('createSession requires an authoritative tenant binding');
  });

  it('every per-branch admin route checks the branch belongs to the session tenant in each handler', () => {
    const routes = SOURCES.filter((f) => /^src\/app\/api\/admin\/branches\/\[id\]\/.*route\.ts$|^src\/app\/api\/admin\/branches\/\[id\]\/route\.ts$/.test(f));
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const file of routes) {
      const src = read(file);
      const handlers = src.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
      const checks = src.match(/branchAdminTenantScopeResponse\(/g) ?? [];
      expect(handlers.length, file).toBeGreaterThan(0);
      expect(checks.length, file).toBeGreaterThanOrEqual(handlers.length);
    }
  });
});
