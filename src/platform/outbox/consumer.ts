import 'server-only';
import type { ConnectionPool } from 'mssql';
import { getPool, sql } from '@/lib/db';
import { buildJobTenantContext, type JobTenantContext } from '../tenant/tenantContext';
import type { OutboxStatus, PlatformOutboxRow } from './types';

export const PLATFORM_OUTBOX_MAX_ATTEMPTS = 10;

/** A claimed unit of work. TenantId always comes from the claimed row, never from the process. */
export interface ClaimedPlatformOutboxEvent {
  row: PlatformOutboxRow;
  tenant: JobTenantContext;
}

export type PlatformOutboxHandler = (event: ClaimedPlatformOutboxEvent) => Promise<void>;

export type PlatformOutboxTickSummary = {
  claimed: number;
  delivered: number;
  retried: number;
  dead: number;
  rejected: number;
};

type RawOutboxRow = {
  Id: number | string;
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventType: string;
  Payload: string;
  IdempotencyKey: string | null;
  CorrelationId: string | null;
  OccurredAt: Date;
  Status: OutboxStatus;
  Attempts: number;
};

function toRow(r: RawOutboxRow): PlatformOutboxRow {
  return {
    id: Number(r.Id),
    tenantId: String(r.TenantId).toLowerCase(),
    aggregateType: String(r.AggregateType),
    aggregateId: String(r.AggregateId),
    eventType: String(r.EventType),
    payload: String(r.Payload),
    idempotencyKey: r.IdempotencyKey ?? null,
    correlationId: r.CorrelationId ?? null,
    occurredAt: r.OccurredAt,
    status: r.Status,
    attempts: Number(r.Attempts),
  };
}

/**
 * Atomically claims pending rows (pending -> delivering, Attempts + 1). READPAST lets parallel
 * workers skip rows another worker is claiming. `tenantId` optionally restricts the claim to
 * one tenant; rows of other tenants are never returned for a tenant-scoped claim.
 */
export async function claimPlatformOutboxBatch(
  opts: { batchSize: number; tenantId?: string | null; eventTypes?: readonly string[] },
  pool?: ConnectionPool,
): Promise<PlatformOutboxRow[]> {
  const db = pool ?? (await getPool());
  const req = db.request().input('batch', sql.Int, Math.max(1, Math.min(opts.batchSize, 500)));
  const filters = [`Status = N'pending'`];
  if (opts.tenantId) {
    req.input('tenantId', sql.UniqueIdentifier, opts.tenantId);
    filters.push('TenantId = @tenantId');
  }
  if (opts.eventTypes && opts.eventTypes.length > 0) {
    const names = opts.eventTypes.map((t, i) => {
      req.input(`et${i}`, sql.NVarChar(128), t);
      return `@et${i}`;
    });
    filters.push(`EventType IN (${names.join(', ')})`);
  }
  const result = await req.query(`
    WITH next AS (
      SELECT TOP (@batch) *
      FROM dbo.PlatformOutbox WITH (UPDLOCK, READPAST, ROWLOCK)
      WHERE ${filters.join(' AND ')}
      ORDER BY Id
    )
    UPDATE next
    SET Status = N'delivering', Attempts = Attempts + 1
    OUTPUT INSERTED.Id, INSERTED.TenantId, INSERTED.AggregateType, INSERTED.AggregateId,
           INSERTED.EventType, INSERTED.Payload, INSERTED.IdempotencyKey, INSERTED.CorrelationId,
           INSERTED.OccurredAt, INSERTED.Status, INSERTED.Attempts;
  `);
  return (result.recordset as RawOutboxRow[]).map(toRow);
}

/** Completion is keyed by (Id, TenantId) so a worker can never settle another tenant's row. */
async function settle(
  db: ConnectionPool,
  row: PlatformOutboxRow,
  status: Exclude<OutboxStatus, 'delivering'>,
): Promise<void> {
  await db
    .request()
    .input('id', sql.BigInt, row.id)
    .input('tenantId', sql.UniqueIdentifier, row.tenantId)
    .input('status', sql.NVarChar(20), status)
    .query(`
      UPDATE dbo.PlatformOutbox
      SET Status = @status
      WHERE Id = @id AND TenantId = @tenantId AND Status = N'delivering';
    `);
}

/**
 * One consumer tick: claim, build a JobTenantContext per row, dispatch, settle.
 * A row without a valid TenantId is dead-lettered and never dispatched.
 */
export async function processPlatformOutboxTick(
  handler: PlatformOutboxHandler,
  opts: {
    batchSize: number;
    tenantId?: string | null;
    eventTypes?: readonly string[];
    maxAttempts?: number;
    source?: string;
  },
  pool?: ConnectionPool,
): Promise<PlatformOutboxTickSummary> {
  const db = pool ?? (await getPool());
  const maxAttempts = opts.maxAttempts ?? PLATFORM_OUTBOX_MAX_ATTEMPTS;
  const rows = await claimPlatformOutboxBatch(opts, db);
  const summary: PlatformOutboxTickSummary = {
    claimed: rows.length,
    delivered: 0,
    retried: 0,
    dead: 0,
    rejected: 0,
  };

  for (const row of rows) {
    let tenant: JobTenantContext;
    try {
      tenant = buildJobTenantContext(row.tenantId, opts.source ?? `platform-outbox:${row.eventType}`);
    } catch {
      summary.rejected += 1;
      await settle(db, row, 'dead');
      continue;
    }
    try {
      await handler({ row, tenant });
      await settle(db, row, 'delivered');
      summary.delivered += 1;
    } catch (err) {
      const terminal = row.attempts >= maxAttempts;
      await settle(db, row, terminal ? 'dead' : 'pending');
      if (terminal) summary.dead += 1;
      else summary.retried += 1;
      console.error('[platform-outbox] handler failed', {
        id: row.id,
        tenantId: row.tenantId,
        eventType: row.eventType,
        attempts: row.attempts,
        terminal,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}
