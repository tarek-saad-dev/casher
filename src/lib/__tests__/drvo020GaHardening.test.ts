import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  hashPassword,
  isPasswordHash,
  PASSWORD_HASH_MAX_LENGTH,
  verifyPassword,
} from '@/lib/auth/passwordHash';
import { buildLogRecord, createLogger, REDACTED, setLogSink } from '@/lib/observability/logger';
import { captureException, setErrorReporter, type ErrorReport } from '@/lib/observability/errorTracking';
import { evaluateReadiness } from '@/lib/observability/readiness';
import { PUBLIC_EXACT_ROUTES } from '@/lib/proxyPublicRoutes';
import { buildBackupPlan, buildRestorePlan, BackupPlanError } from '../../../scripts/drvo/backupPlan';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('DRVO-020 password hashing', () => {
  it('produces salted hashes that fit the legacy nvarchar(50) Password column', async () => {
    const a = await hashPassword('secret-1');
    const b = await hashPassword('secret-1');
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(PASSWORD_HASH_MAX_LENGTH);
    expect(isPasswordHash(a)).toBe(true);
    expect(a).not.toContain('secret-1');
  });

  it('verifies hashes and rejects wrong passwords without asking for an upgrade', async () => {
    const stored = await hashPassword('Correct Horse');
    expect(await verifyPassword('Correct Horse', stored)).toEqual({ ok: true, needsUpgrade: false });
    expect(await verifyPassword('correct horse', stored)).toEqual({ ok: false, needsUpgrade: false });
  });

  it('accepts legacy plaintext with the old SQL collation semantics and flags it for upgrade', async () => {
    expect(await verifyPassword('abc123', 'abc123')).toEqual({ ok: true, needsUpgrade: true });
    expect(await verifyPassword('ABC123', 'abc123  ')).toEqual({ ok: true, needsUpgrade: true });
    expect(await verifyPassword('abc124', 'abc123')).toEqual({ ok: false, needsUpgrade: false });
    expect(await verifyPassword('', 'abc123')).toEqual({ ok: false, needsUpgrade: false });
    expect(await verifyPassword('abc', null)).toEqual({ ok: false, needsUpgrade: false });
  });
});

describe('DRVO-020 login upgrades legacy plaintext and never logs passwords', () => {
  const logLines: string[] = [];
  const queries: { sql: string; inputs: Record<string, unknown> }[] = [];

  beforeEach(() => {
    vi.resetModules();
    logLines.length = 0;
    queries.length = 0;
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/session', () => ({
      createSession: vi.fn(async () => undefined),
      assertSessionSecretConfigured: () => undefined,
      SessionConfigError: class SessionConfigError extends Error {},
    }));
    vi.doMock('@/lib/branch/access', () => ({
      resolveLoginDefaultBranch: vi.fn(async () => ({ branchId: 3, branchCode: 'B1', branchName: 'Branch' })),
    }));
    vi.doMock('@/platform/tenant/tenantContext', () => ({
      isTenantContextError: () => false,
      resolveStaffTenantContextForRequest: vi.fn(async () => ({ tenantId: 'tenant-a', membershipId: 'm-1' })),
    }));
    vi.doMock('@/lib/permissions-server', () => ({
      getUserAccess: vi.fn(async () => ({
        defaultLandingPath: '/income/pos',
        isPartnerOnly: false,
        roles: [],
        allowedPagePaths: [],
      })),
    }));
  });

  afterEach(() => {
    setLogSink(null);
  });

  async function login(storedPassword: string, password: string) {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const inputs: Record<string, unknown> = {};
          const api = {
            input: (name: string, value: unknown) => {
              inputs[name] = value;
              return api;
            },
            query: async (sqlText: string) => {
              queries.push({ sql: sqlText, inputs });
              if (/SELECT UserID/.test(sqlText)) {
                return {
                  recordset: [
                    { UserID: 7, UserName: 'Owner', UserLevel: 'admin', loginName: 'owner', ShiftID: 1, StoredPassword: storedPassword },
                  ],
                };
              }
              return { recordset: [], rowsAffected: [1] };
            },
          };
          return api;
        },
      })),
      sql: { NVarChar: (n: number) => n, Int: 'Int' },
      getUserFriendlyError: () => 'masked',
    }));
    const { setLogSink: setSink } = await import('@/lib/observability/logger');
    setSink((_level, line) => logLines.push(line));
    const { POST } = await import('@/app/api/auth/login/route');
    return POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ loginName: 'owner', password }),
      }),
    );
  }

  it('no longer compares passwords in SQL', async () => {
    await login('pw-legacy', 'pw-legacy');
    const lookup = queries.find((q) => /SELECT UserID/.test(q.sql));
    expect(lookup?.sql).not.toMatch(/Password\s*=\s*@password/);
    expect(lookup?.inputs).not.toHaveProperty('password');
  });

  it('upgrades a legacy plaintext row to a hash on successful login', async () => {
    const res = await login('pw-legacy', 'pw-legacy');
    expect(res.status).toBe(200);
    const update = queries.find((q) => /UPDATE \[dbo\]\.\[TblUser\]/.test(q.sql));
    expect(update).toBeDefined();
    expect(isPasswordHash(String(update?.inputs.hashed))).toBe(true);
    expect(update?.inputs.previous).toBe('pw-legacy');
    expect(update?.sql).toMatch(/WHERE UserID = @userId AND Password = @previous/);
  });

  it('logs in against a hashed row without rewriting it', async () => {
    const stored = await hashPassword('pw-new');
    const res = await login(stored, 'pw-new');
    expect(res.status).toBe(200);
    expect(queries.some((q) => /UPDATE \[dbo\]\.\[TblUser\]/.test(q.sql))).toBe(false);
  });

  it('rejects a wrong password with 401', async () => {
    const res = await login('pw-legacy', 'nope');
    expect(res.status).toBe(401);
    expect(queries.some((q) => /UPDATE/.test(q.sql))).toBe(false);
  });

  it('emits tenant-tagged JSON logs that never contain the password', async () => {
    await login('pw-legacy-SECRET', 'pw-legacy-SECRET');
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line).not.toContain('pw-legacy-SECRET');
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const success = logLines.map((l) => JSON.parse(l)).find((r) => r.event === 'success');
    expect(success).toMatchObject({ scope: 'auth/login', tenantId: 'tenant-a', userId: 7 });
  });
});

describe('DRVO-020 password write paths hash before storing', () => {
  it.each([
    'src/lib/tenant/tenantStaffUsers.ts',
    'src/app/api/users/[id]/route.ts',
    'src/platform/onboarding/provisionTenant.ts',
  ])('%s hashes the password input', (file) => {
    const src = read(file);
    expect(src).toMatch(/hashPassword\(/);
    expect(src).not.toMatch(/\.input\(\s*'Password',\s*sql\.NVarChar\(50\),\s*Password\s*\)/);
    expect(src).not.toMatch(/\.input\(\s*'(password|Password)',\s*sql\.NVarChar\(50\),\s*input\.password\s*\)/);
  });
});

describe('DRVO-020 structured logs', () => {
  it('redacts sensitive keys at any depth and tags tenant/request context', () => {
    const record = buildLogRecord({ scope: 'x', tenantId: 't-1', requestId: 'r-1' }, 'info', 'evt', {
      password: 'p',
      nested: { apiKey: 'k', Authorization: 'Bearer z', ok: 1 },
      list: [{ token: 't' }],
    });
    expect(record).toMatchObject({
      scope: 'x',
      event: 'evt',
      tenantId: 't-1',
      requestId: 'r-1',
      password: REDACTED,
      nested: { apiKey: REDACTED, Authorization: REDACTED, ok: 1 },
      list: [{ token: REDACTED }],
    });
  });

  it('fields cannot override the tenant tag', () => {
    const record = buildLogRecord({ scope: 'x', tenantId: 't-1' }, 'info', 'evt', { tenantId: 'spoof' });
    expect(record.tenantId).toBe('t-1');
  });

  it('defaults tenantId to null for platform-level events', () => {
    const lines: string[] = [];
    setLogSink((_l, line) => lines.push(line));
    createLogger({ scope: 'boot' }).info('started');
    setLogSink(null);
    expect(JSON.parse(lines[0])).toMatchObject({ tenantId: null, event: 'started' });
  });
});

describe('DRVO-020 error tracking seam', () => {
  afterEach(() => {
    setErrorReporter(null);
    setLogSink(null);
  });

  it('forwards normalized, redacted reports to the configured reporter', () => {
    const reports: ErrorReport[] = [];
    setErrorReporter((r) => {
      reports.push(r);
    });
    captureException(new Error('boom'), { scope: 's', tenantId: 't-9' }, { secret: 'x', route: '/a' });
    expect(reports[0].error.message).toBe('boom');
    expect(reports[0].context.tenantId).toBe('t-9');
    expect(reports[0].extra).toEqual({ secret: REDACTED, route: '/a' });
  });

  it('never throws when the reporter fails, falling back to the log sink', () => {
    const lines: string[] = [];
    setLogSink((_l, line) => lines.push(line));
    setErrorReporter(() => {
      throw new Error('vendor down');
    });
    expect(() => captureException('plain', { scope: 's' })).not.toThrow();
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'exception', level: 'error' });
  });

  it('is wired into Next onRequestError without forwarding request headers', () => {
    const src = read('src/instrumentation.ts');
    expect(src).toMatch(/export const onRequestError/);
    expect(src).toMatch(/captureException\(/);
    expect(src).not.toMatch(/request\.headers/);
  });
});

describe('DRVO-020 health and readiness', () => {
  it('reports ready only when every probe passes and hides failure details', async () => {
    const ok = await evaluateReadiness({ database: async () => {}, sessionSecret: async () => {} });
    expect(ok.status).toBe('ready');

    const bad = await evaluateReadiness({
      database: async () => {
        throw new Error('Login failed for user sa on 10.0.0.5');
      },
      sessionSecret: async () => {},
    });
    expect(bad.status).toBe('not_ready');
    expect(JSON.stringify(bad)).not.toContain('10.0.0.5');
    expect(bad.checks.find((c) => c.name === 'database')?.ok).toBe(false);
  });

  it('times out hanging probes', async () => {
    const report = await evaluateReadiness(
      { database: () => new Promise(() => {}), sessionSecret: async () => {} },
      20,
    );
    expect(report.status).toBe('not_ready');
  });

  it('exposes live/ready probes publicly and keeps /api/health/db private', () => {
    expect(PUBLIC_EXACT_ROUTES).toContain('/api/health/live');
    expect(PUBLIC_EXACT_ROUTES).toContain('/api/health/ready');
    expect(PUBLIC_EXACT_ROUTES as readonly string[]).not.toContain('/api/health/db');
    expect(read('src/app/api/health/ready/route.ts')).not.toMatch(/@@VERSION|@@SERVERNAME|DB_SERVER/);
  });
});

describe('DRVO-020 backup / restore hooks', () => {
  const now = new Date('2026-10-08T01:02:03.456Z');

  it('plans a COPY_ONLY checksum backup with verification', () => {
    const plan = buildBackupPlan({ database: 'last132_agent', backupDir: '/var/opt/mssql/backup/', now });
    expect(plan.backupFile).toBe('/var/opt/mssql/backup/last132_agent_20261008T010203Z.bak');
    expect(plan.backupSql).toMatch(/BACKUP DATABASE \[last132_agent\].*COPY_ONLY, CHECKSUM/);
    expect(plan.verifySql).toMatch(/RESTORE VERIFYONLY .* WITH CHECKSUM/);
  });

  it('refuses production without explicit opt-in and rejects injection', () => {
    expect(() => buildBackupPlan({ database: 'last132', backupDir: '/b', now })).toThrow(BackupPlanError);
    expect(buildBackupPlan({ database: 'last132', backupDir: '/b', now, allowProduction: true }).database).toBe('last132');
    expect(() => buildBackupPlan({ database: 'x]; DROP', backupDir: '/b', now })).toThrow(BackupPlanError);
    expect(() => buildBackupPlan({ database: 'db', backupDir: "/b'; --", now })).toThrow(BackupPlanError);
  });

  it('restore drills can only target *_restore_check scratch databases', () => {
    expect(() => buildRestorePlan({ backupFile: '/b/x.bak', targetDatabase: 'last132' })).toThrow(BackupPlanError);
    expect(() => buildRestorePlan({ backupFile: '/b/x.bak', targetDatabase: 'last132_agent' })).toThrow(BackupPlanError);
    const plan = buildRestorePlan({ backupFile: '/b/x.bak', targetDatabase: 'last132_restore_check' });
    const sql = plan.buildRestoreSql(
      [
        { logicalName: 'last132', type: 'D' },
        { logicalName: 'last132_log', type: 'L' },
      ],
      '/var/opt/mssql/data',
    );
    expect(sql).toMatch(/^RESTORE DATABASE \[last132_restore_check\]/);
    expect(sql).toContain("MOVE N'last132' TO N'/var/opt/mssql/data/last132_restore_check_0.mdf'");
    expect(sql).toContain("MOVE N'last132_log' TO N'/var/opt/mssql/data/last132_restore_check_1.ldf'");
  });

  it('runbook and npm hook exist', () => {
    expect(read('docs/drvo/DRVO-020-BACKUP-RESTORE-RUNBOOK.md')).toMatch(/RESTORE VERIFYONLY/);
    expect(JSON.parse(read('package.json')).scripts['drvo:backup']).toBe('tsx scripts/drvo/db-backup.ts');
  });
});

describe('DRVO-020 deploy path', () => {
  it('application deploy no longer applies messaging schema migrations unless explicitly approved', () => {
    const deploy = read('deploy/deploy-casher');
    const gate = deploy.indexOf('CASHER_APPLY_MESSAGING_SCHEMA:-}" == "I_HAVE_A_VERIFIED_BACKUP"');
    expect(gate).toBeGreaterThan(-1);
    const elseBranch = deploy.indexOf('else', gate);
    const fi = deploy.indexOf('\nfi', gate);
    for (const script of [
      'messaging:migrate-ai',
      'messaging:migrate-salon-concierge',
      'messaging:migrate-handoff',
      'messaging:migrate-booking-management',
    ]) {
      const all = [...deploy.matchAll(new RegExp(script.replace(/[-:]/g, '\\$&'), 'g'))].map((m) => m.index ?? -1);
      expect(all.length).toBeGreaterThan(0);
      for (const at of all) {
        expect(at).toBeGreaterThan(gate);
        expect(at).toBeLessThan(elseBranch);
      }
    }
    expect(fi).toBeGreaterThan(elseBranch);
  });

  it('does not touch the production GitHub deploy workflow', () => {
    expect(read('.github/workflows/deploy-vps.yml')).not.toMatch(/CASHER_APPLY_MESSAGING_SCHEMA/);
  });
});
