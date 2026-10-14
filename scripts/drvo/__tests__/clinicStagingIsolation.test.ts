import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const query = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const connect = vi.fn();
  const pool = { request: () => ({ query }), close, connect };
  connect.mockResolvedValue(pool);
  return { query, close, connect, pool };
});
vi.mock('mssql', () => ({ default: { ConnectionPool: class { constructor() { return db.pool; } } } }));

describe('clinic staging isolation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('DRVO_STAGING_DB_PASSWORD', 'synthetic-test-password');
    vi.stubEnv('DRVO_STAGING_DB_SERVER', '127.0.0.1');
    vi.stubEnv('DRVO_STAGING_DB_PORT', '1433');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = 0;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); process.exitCode = 0; });

  it.each(['preflight', 'plan'])('refuses unknown production access in %s', async (command) => {
    db.query.mockResolvedValue({ recordset: [{ db: 'last132_agent', login: 'drvo_agent', productionAccess: null, objectId: 1 }] });
    if (command === 'preflight') await import('../drvo-014-staging-preflight');
    else await import('../drvo-014-staging-plan');
    await vi.waitFor(() => expect(db.close).toHaveBeenCalled());
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(console.error).toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledOnce();
  });
});
