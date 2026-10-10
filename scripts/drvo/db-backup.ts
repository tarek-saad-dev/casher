#!/usr/bin/env npx tsx
/**
 * DRVO-020 backup / restore-drill hooks. Dry-run by default (prints T-SQL only).
 *
 *   npm run drvo:backup -- --backup-dir=/var/opt/mssql/backup            # plan backup of the connected DB
 *   npm run drvo:backup -- --backup-dir=... --execute                    # run BACKUP + RESTORE VERIFYONLY
 *   npm run drvo:backup -- --restore-from=<file.bak> --restore-to=<db>_restore_check --data-dir=... --execute
 *
 * The connected database is DB_NAME() of the configured pool; production needs --allow-production.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
import { buildBackupPlan, buildRestorePlan, type RestoreFile } from './backupPlan';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const allowProduction = process.argv.includes('--allow-production');
  const restoreFrom = arg('restore-from');

  const { getPool, closePool } = await import('../../src/lib/db');
  try {
    const pool = await getPool();
    const dbName = String((await pool.request().query('SELECT DB_NAME() AS db')).recordset[0]?.db ?? '');

    if (restoreFrom) {
      const plan = buildRestorePlan({ backupFile: restoreFrom, targetDatabase: arg('restore-to') ?? '' });
      const dataDir = arg('data-dir') ?? '';
      console.log(`-- restore drill: ${restoreFrom} -> ${plan.targetDatabase}`);
      console.log(plan.fileListSql);
      if (!execute) {
        console.log('-- dry run: pass --execute to read the file list and restore.');
        return;
      }
      const files = (await pool.request().query(plan.fileListSql)).recordset.map(
        (r: { LogicalName: string; Type: string }) =>
          ({ logicalName: r.LogicalName, type: r.Type === 'L' ? 'L' : 'D' }) as RestoreFile,
      );
      const restoreSql = plan.buildRestoreSql(files, dataDir);
      console.log(restoreSql);
      await pool.request().batch(restoreSql);
      console.log(`PASS: restored into ${plan.targetDatabase}. Run drvo:verify against it, then drop it.`);
      return;
    }

    const plan = buildBackupPlan({ database: dbName, backupDir: arg('backup-dir') ?? '', allowProduction });
    console.log(plan.backupSql);
    console.log(plan.verifySql);
    if (!execute) {
      console.log('-- dry run: pass --execute to run the backup and verification.');
      return;
    }
    await pool.request().batch(plan.backupSql);
    await pool.request().batch(plan.verifySql);
    console.log(`PASS: ${plan.backupFile} written and verified.`);
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
