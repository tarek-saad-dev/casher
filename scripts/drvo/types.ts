import type { ConnectionPool } from 'mssql';

export const PRODUCTION_DB = 'last132';
export const STAGING_DB = 'last132_agent';

export type DrvoMigrationContext = {
  pool: ConnectionPool;
  database: string;
  appCommitSha: string | null;
};

export type DrvoMigrationVerifyResult = {
  ok: boolean;
  failures: string[];
};

export type DrvoMigrationDefinition = {
  migrationId: number;
  migrationKey: string;
  name: string;
  dependencies: string[];
  /** SHA-256 hex of migration artifacts (computed at load time). */
  checksum: string;
  /** Apply migration body. Must be idempotent. */
  apply: (ctx: DrvoMigrationContext) => Promise<void>;
  /** Read-only verification after apply/baseline. */
  verify: (ctx: DrvoMigrationContext) => Promise<DrvoMigrationVerifyResult>;
  /**
   * If production already has valid state but no registry row, register safely.
   * Return true when baseline was recognized and caller should record the migration.
   */
  reconcileBaseline?: (ctx: DrvoMigrationContext) => Promise<boolean>;
};

export type AppliedDrvoMigrationRow = {
  MigrationId: number;
  MigrationKey: string;
  Name: string;
  Checksum: string;
  AppliedAtUtc: Date;
  AppCommitSha: string | null;
  ExecutionMs: number;
};

export type DrvoMigrationRunReport = {
  database: string;
  applied: string[];
  skipped: string[];
  baselined: string[];
  ok: boolean;
  failures: string[];
};

export type DrvoReadinessCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type DrvoModuleReadinessReport = {
  module: string;
  ok: boolean;
  checks: DrvoReadinessCheck[];
  requiredMigrationKeys: string[];
};
