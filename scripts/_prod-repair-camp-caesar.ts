/**
 * Production Camp Caesar repair (transactional). Not for commit.
 * CASE A: --sync-flags only
 * CASE B: --restore-internal-live (SETUP demotion repair)
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* optional */
  }
}

const args = process.argv.slice(2);
const syncFlags = args.includes('--sync-flags');
const restore = args.includes('--restore-internal-live');
const dryRun = args.includes('--dry-run');

async function loadModules() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Module = await import('module');
  const orig = (Module as any).default._load;
  (Module as any).default._load = function (request: string, ...rest: unknown[]) {
    if (request === 'server-only') return {};
    return orig.call(this, request, ...rest);
  };
  const { getBranchByCode } = await import('../src/lib/branch/repository');
  const { syncOperationalFlagsFromLifecycle } = await import(
    '../src/lib/branch/syncOperationalFlagsFromLifecycle'
  );
  const { getPool, sql } = await import('../src/lib/db');
  return { getBranchByCode, syncOperationalFlagsFromLifecycle, getPool, sql };
}

async function snapshot(getBranchByCode: (code: string) => Promise<unknown>) {
  const cc = await getBranchByCode('CAMP_CAESAR');
  const gleem = await getBranchByCode('GLEEM');
  return { cc, gleem };
}

async function restoreInternalLive(
  getPool: () => Promise<import('mssql').ConnectionPool>,
  sql: typeof import('../src/lib/db').sql,
  dryRun: boolean,
) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const before = await new sql.Request(tx).query(`
      SELECT BranchID, BranchCode, LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
      FROM dbo.TblBranch WHERE BranchCode = N'CAMP_CAESAR'
    `);
    const row = before.recordset[0];
    if (!row) throw new Error('CAMP_CAESAR not found');
    if (String(row.BranchCode) !== 'CAMP_CAESAR') throw new Error('BranchCode mismatch');

    const ls = String(row.LifecycleStatus);
    const isActive = Boolean(row.IsActive);
    if (ls === 'INTERNAL_LIVE' && isActive) {
      await tx.rollback();
      return { action: 'NONE_ALREADY_LIVE', before: row };
    }
    if (ls !== 'SETUP' || isActive) {
      await tx.rollback();
      throw new Error(`Unexpected state for restore: LifecycleStatus=${ls} IsActive=${isActive ? 1 : 0}`);
    }

    if (dryRun) {
      await tx.rollback();
      return { action: 'DRY_RUN_RESTORE', before: row };
    }

    const upd = await new sql.Request(tx).query(`
      UPDATE dbo.TblBranch
      SET LifecycleStatus = N'INTERNAL_LIVE',
          IsActive = 1,
          PublicBookingEnabled = 0,
          ExternalNotificationsEnabled = 1,
          UpdatedAt = SYSUTCDATETIME()
      WHERE BranchCode = N'CAMP_CAESAR'
        AND LifecycleStatus = N'SETUP'
        AND IsActive = 0;
      SELECT @@ROWCOUNT AS Affected;
    `);
    const affected = Number(upd.recordset[0]?.Affected ?? 0);
    if (affected !== 1) {
      await tx.rollback();
      throw new Error(`Expected 1 branch row updated, got ${affected}`);
    }

    await new sql.Request(tx).query(`
      UPDATE dbo.QueueBookingSettings
      SET BookingEnabled = 0, UpdatedAt = GETDATE()
      WHERE BranchID = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'CAMP_CAESAR');
    `);

    const after = await new sql.Request(tx).query(`
      SELECT BranchID, BranchCode, LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
      FROM dbo.TblBranch WHERE BranchCode = N'CAMP_CAESAR'
    `);

    await tx.commit();
    return { action: 'RESTORE_INTERNAL_LIVE', before: row, after: after.recordset[0] };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

async function main() {
  if (!syncFlags && !restore) {
    console.error('Usage: --sync-flags and/or --restore-internal-live [--dry-run]');
    process.exit(1);
  }

  const { getBranchByCode, syncOperationalFlagsFromLifecycle, getPool, sql } =
    await loadModules();

  const before = await snapshot(getBranchByCode);
  console.log('BEFORE:', JSON.stringify(before, null, 2));

  const results: unknown[] = [];

  if (syncFlags) {
    const cc = before.cc as { branchId: number } | null;
    if (!cc) throw new Error('CAMP_CAESAR missing');
    if (dryRun) {
      results.push({ action: 'DRY_RUN_SYNC_FLAGS' });
    } else {
      results.push(await syncOperationalFlagsFromLifecycle(cc.branchId));
    }
  }

  if (restore) {
    results.push(await restoreInternalLive(getPool, sql, dryRun));
  }

  const after = await snapshot(getBranchByCode);
  console.log('REPAIR:', JSON.stringify(results, null, 2));
  console.log('AFTER:', JSON.stringify(after, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
