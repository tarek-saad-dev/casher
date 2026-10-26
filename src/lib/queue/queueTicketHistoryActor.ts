/**
 * QueueTicketHistory uses ActionByUserID in the original queue-booking schema.
 * Some legacy installations use UserID instead. Resolve the actual column at
 * runtime; SQL column identifiers are selected from this fixed allowlist only.
 */
import 'server-only';
import type sql from 'mssql';

export type QueueHistoryActorColumn = 'ActionByUserID' | 'UserID';

export function normalizeQueueHistoryActorColumn(value: unknown): QueueHistoryActorColumn {
  if (value === 'ActionByUserID' || value === 'UserID') return value;
  throw new Error('QueueTicketHistory requires ActionByUserID or UserID column');
}

export async function resolveQueueHistoryActorColumn(
  db: sql.ConnectionPool,
): Promise<QueueHistoryActorColumn> {
  const result = await db.request().query(`
    SELECT CASE
      WHEN COL_LENGTH('dbo.QueueTicketHistory', 'ActionByUserID') IS NOT NULL THEN N'ActionByUserID'
      WHEN COL_LENGTH('dbo.QueueTicketHistory', 'UserID') IS NOT NULL THEN N'UserID'
      ELSE NULL
    END AS ActorColumn
  `);
  return normalizeQueueHistoryActorColumn(result.recordset[0]?.ActorColumn);
}
