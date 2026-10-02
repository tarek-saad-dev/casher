import 'server-only';
import { sql } from '@/lib/db';
import type { Transaction } from 'mssql';

export class TreasuryIdempotencyConflictError extends Error {
  constructor(message = 'Treasury idempotency fingerprint conflict') {
    super(message);
    this.name = 'TreasuryIdempotencyConflictError';
  }
}

export type RegistryRow = {
  Id: number;
  TenantId: string;
  IdempotencyKey: string;
  Fingerprint: string;
  Kind: string;
  CashMoveId: number;
  TransferGroupKey: string | null;
  OriginalIdempotencyKey: string | null;
  SourceRef: string | null;
};

export async function findRegistryByKey(
  tx: Transaction,
  tenantId: string,
  idempotencyKey: string,
): Promise<RegistryRow | null> {
  const result = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('key', sql.NVarChar(256), idempotencyKey)
    .query(`
      SELECT TOP 1
        Id, TenantId, IdempotencyKey, Fingerprint, Kind, CashMoveId,
        TransferGroupKey, OriginalIdempotencyKey, SourceRef
      FROM dbo.TreasuryMovementRegistry WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId AND IdempotencyKey = @key
    `);
  return (result.recordset[0] as RegistryRow | undefined) ?? null;
}

export async function findRegistryRowsByTransferGroup(
  tx: Transaction,
  tenantId: string,
  transferGroupKey: string,
): Promise<RegistryRow[]> {
  const result = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('groupKey', sql.NVarChar(256), transferGroupKey)
    .query(`
      SELECT
        Id, TenantId, IdempotencyKey, Fingerprint, Kind, CashMoveId,
        TransferGroupKey, OriginalIdempotencyKey, SourceRef
      FROM dbo.TreasuryMovementRegistry WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId AND TransferGroupKey = @groupKey
      ORDER BY Id
    `);
  return result.recordset as RegistryRow[];
}

export async function updateRegistryRow(
  tx: Transaction,
  row: {
    tenantId: string;
    idempotencyKey: string;
    fingerprint: string;
    cashMoveId: number;
  },
): Promise<void> {
  await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, row.tenantId)
    .input('key', sql.NVarChar(256), row.idempotencyKey)
    .input('fingerprint', sql.NVarChar(128), row.fingerprint)
    .input('cashMoveId', sql.Int, row.cashMoveId)
    .query(`
      UPDATE dbo.TreasuryMovementRegistry
      SET Fingerprint = @fingerprint, CashMoveId = @cashMoveId
      WHERE TenantId = @tenantId AND IdempotencyKey = @key AND Kind = N'sale'
    `);
}

export async function deleteRegistryByKey(
  tx: Transaction,
  tenantId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const result = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('key', sql.NVarChar(256), idempotencyKey)
    .query(`
      DELETE FROM dbo.TreasuryMovementRegistry
      WHERE TenantId = @tenantId AND IdempotencyKey = @key AND Kind = N'sale'
    `);
  return (result.rowsAffected[0] ?? 0) > 0;
}

export async function insertRegistryRow(
  tx: Transaction,
  row: {
    tenantId: string;
    idempotencyKey: string;
    fingerprint: string;
    kind: string;
    cashMoveId: number;
    transferGroupKey?: string | null;
    originalIdempotencyKey?: string | null;
    sourceRef?: string | null;
  },
): Promise<void> {
  await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, row.tenantId)
    .input('key', sql.NVarChar(256), row.idempotencyKey)
    .input('fingerprint', sql.NVarChar(128), row.fingerprint)
    .input('kind', sql.NVarChar(32), row.kind)
    .input('cashMoveId', sql.Int, row.cashMoveId)
    .input('transferGroupKey', sql.NVarChar(256), row.transferGroupKey ?? null)
    .input('originalKey', sql.NVarChar(256), row.originalIdempotencyKey ?? null)
    .input('sourceRef', sql.NVarChar(256), row.sourceRef ?? null)
    .query(`
      INSERT INTO dbo.TreasuryMovementRegistry (
        TenantId, IdempotencyKey, Fingerprint, Kind, CashMoveId,
        TransferGroupKey, OriginalIdempotencyKey, SourceRef
      )
      VALUES (
        @tenantId, @key, @fingerprint, @kind, @cashMoveId,
        @transferGroupKey, @originalKey, @sourceRef
      )
    `);
}

export function isRegistryUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const number =
    err && typeof err === 'object' && 'number' in err
      ? Number((err as { number?: number }).number)
      : undefined;
  if (number === 2601 || number === 2627) return true;
  return /UX_TreasuryMovementRegistry_Tenant_Idempotency|Cannot insert duplicate key/i.test(message);
}
