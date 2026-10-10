import { PRODUCTION_DB } from './types';

export class BackupPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupPlanError';
  }
}

const DATABASE_NAME = /^[A-Za-z0-9_]{1,128}$/;
const RESTORE_TARGET_SUFFIX = '_restore_check';

function assertDatabaseName(name: string, label: string) {
  if (!DATABASE_NAME.test(name)) {
    throw new BackupPlanError(`${label} must match ${DATABASE_NAME} (got "${name}").`);
  }
}

function assertDiskPath(value: string, label: string) {
  if (!value || /['\r\n;]/.test(value)) {
    throw new BackupPlanError(`${label} must be a plain path without quotes, semicolons or newlines.`);
  }
}

function timestampForFile(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export type BackupPlan = {
  database: string;
  backupFile: string;
  backupSql: string;
  verifySql: string;
};

/**
 * COPY_ONLY so an ad-hoc/pre-migration backup never breaks the production log-backup chain.
 * Production additionally requires an explicit opt-in.
 */
export function buildBackupPlan(input: {
  database: string;
  backupDir: string;
  now?: Date;
  allowProduction?: boolean;
}): BackupPlan {
  assertDatabaseName(input.database, 'database');
  assertDiskPath(input.backupDir, 'backupDir');
  if (input.database === PRODUCTION_DB && !input.allowProduction) {
    throw new BackupPlanError(`Refusing production database ${PRODUCTION_DB} without --allow-production.`);
  }
  const dir = input.backupDir.replace(/[\\/]+$/, '');
  const backupFile = `${dir}/${input.database}_${timestampForFile(input.now ?? new Date())}.bak`;
  return {
    database: input.database,
    backupFile,
    backupSql: `BACKUP DATABASE [${input.database}] TO DISK = N'${backupFile}' WITH COPY_ONLY, CHECKSUM, INIT, STATS = 10;`,
    verifySql: `RESTORE VERIFYONLY FROM DISK = N'${backupFile}' WITH CHECKSUM;`,
  };
}

export type RestoreFile = { logicalName: string; type: 'D' | 'L' };

export type RestorePlan = {
  targetDatabase: string;
  fileListSql: string;
  buildRestoreSql: (files: RestoreFile[], dataDir: string) => string;
};

/**
 * Restore drills only: the target must be a `<name>_restore_check` scratch database, so this hook
 * can never overwrite production or staging. Restoring production itself stays a manual runbook step.
 */
export function buildRestorePlan(input: { backupFile: string; targetDatabase: string }): RestorePlan {
  assertDiskPath(input.backupFile, 'backupFile');
  assertDatabaseName(input.targetDatabase, 'targetDatabase');
  if (!input.targetDatabase.endsWith(RESTORE_TARGET_SUFFIX) || input.targetDatabase === PRODUCTION_DB) {
    throw new BackupPlanError(
      `Restore target must be a scratch database ending in "${RESTORE_TARGET_SUFFIX}" (got "${input.targetDatabase}").`,
    );
  }
  const target = input.targetDatabase;
  return {
    targetDatabase: target,
    fileListSql: `RESTORE FILELISTONLY FROM DISK = N'${input.backupFile}';`,
    buildRestoreSql: (files, dataDir) => {
      assertDiskPath(dataDir, 'dataDir');
      if (!files.some((f) => f.type === 'D')) throw new BackupPlanError('Backup has no data file.');
      const dir = dataDir.replace(/[\\/]+$/, '');
      const moves = files.map((f, i) => {
        if (/['\]]/.test(f.logicalName)) throw new BackupPlanError(`Unsupported logical file name ${f.logicalName}.`);
        const ext = f.type === 'L' ? 'ldf' : i === 0 ? 'mdf' : 'ndf';
        return `MOVE N'${f.logicalName}' TO N'${dir}/${target}_${i}.${ext}'`;
      });
      return `RESTORE DATABASE [${target}] FROM DISK = N'${input.backupFile}' WITH ${moves.join(', ')}, CHECKSUM, REPLACE, RECOVERY, STATS = 10;`;
    },
  };
}
