import { getPool, sql } from '@/lib/db';
import {
  isConversationControlMode,
  isHandoffTakeoverSource,
  type ConversationControlState,
  type ControlTransition,
} from '../domain/types';

type Raw = {
  ConversationID: number | string;
  ControlMode: string;
  ControlVersion: number | string | null;
  HumanLeaseUntil: Date | string | null;
  HumanLastActivityAt: Date | string | null;
  TakeoverSource: string | null;
  TakenOverByUserID: number | null;
  HandoffReason: string | null;
  HandoffRequestedAt: Date | string | null;
  LastHumanMessageID: number | string | null;
  LastBotMessageID: number | string | null;
  LastCustomerMessageID: number | string | null;
  UnreadCount: number | string | null;
};

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapControlState(row: Raw): ConversationControlState {
  const mode = isConversationControlMode(row.ControlMode) ? row.ControlMode : 'BOT';
  return {
    conversationId: Number(row.ConversationID),
    mode,
    controlVersion: Number(row.ControlVersion ?? 1),
    humanLeaseUntil: toIso(row.HumanLeaseUntil),
    humanLastActivityAt: toIso(row.HumanLastActivityAt),
    takeoverSource: row.TakeoverSource && isHandoffTakeoverSource(row.TakeoverSource) ? row.TakeoverSource : null,
    takenOverByUserId: row.TakenOverByUserID == null ? null : Number(row.TakenOverByUserID),
    handoffReason: row.HandoffReason != null ? String(row.HandoffReason) : null,
    handoffRequestedAt: toIso(row.HandoffRequestedAt),
    lastHumanMessageId: row.LastHumanMessageID == null ? null : Number(row.LastHumanMessageID),
    lastBotMessageId: row.LastBotMessageID == null ? null : Number(row.LastBotMessageID),
    lastCustomerMessageId: row.LastCustomerMessageID == null ? null : Number(row.LastCustomerMessageID),
    unreadCount: Number(row.UnreadCount ?? 0),
  };
}

const CONTROL_SELECT = `
  [ConversationID],
  [ControlMode],
  ISNULL([ControlVersion], 1) AS ControlVersion,
  [HumanLeaseUntil],
  [HumanLastActivityAt],
  [TakeoverSource],
  [TakenOverByUserID],
  [HandoffReason],
  [HandoffRequestedAt],
  [LastHumanMessageID],
  [LastBotMessageID],
  [LastCustomerMessageID],
  ISNULL([UnreadCount], 0) AS UnreadCount
`;

export async function getConversationControl(
  conversationId: number,
): Promise<ConversationControlState | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, conversationId)
    .query(`SELECT ${CONTROL_SELECT} FROM dbo.TblBotConversation WHERE ConversationID = @id`);
  const row = result.recordset[0] as Raw | undefined;
  return row ? mapControlState(row) : null;
}

export async function persistControlState(input: {
  previous: ConversationControlState;
  next: ConversationControlState;
  event: ControlTransition | null;
}): Promise<{ ok: true } | { ok: false; code: 'VERSION_CONFLICT' | 'NOT_FOUND' }> {
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const locked = await new sql.Request(tx)
      .input('id', sql.BigInt, input.next.conversationId)
      .query(`
        SELECT ${CONTROL_SELECT}
        FROM dbo.TblBotConversation WITH (UPDLOCK, HOLDLOCK)
        WHERE ConversationID = @id
      `);
    const live = locked.recordset[0] as Raw | undefined;
    if (!live) {
      await tx.rollback();
      return { ok: false, code: 'NOT_FOUND' };
    }
    const liveState = mapControlState(live);
    if (liveState.controlVersion !== input.previous.controlVersion) {
      await tx.rollback();
      return { ok: false, code: 'VERSION_CONFLICT' };
    }

    await new sql.Request(tx)
      .input('id', sql.BigInt, input.next.conversationId)
      .input('mode', sql.NVarChar(20), input.next.mode)
      .input('ver', sql.Int, input.next.controlVersion)
      .input('lease', sql.DateTime2, input.next.humanLeaseUntil ? new Date(input.next.humanLeaseUntil) : null)
      .input('lastAct', sql.DateTime2, input.next.humanLastActivityAt ? new Date(input.next.humanLastActivityAt) : null)
      .input('source', sql.NVarChar(40), input.next.takeoverSource)
      .input('userId', sql.Int, input.next.takenOverByUserId)
      .input('reason', sql.NVarChar(200), input.next.handoffReason)
      .input('reqAt', sql.DateTime2, input.next.handoffRequestedAt ? new Date(input.next.handoffRequestedAt) : null)
      .input('lastHuman', sql.BigInt, input.next.lastHumanMessageId)
      .input('lastBot', sql.BigInt, input.next.lastBotMessageId)
      .input('lastCust', sql.BigInt, input.next.lastCustomerMessageId)
      .input('unread', sql.Int, input.next.unreadCount)
      .query(`
        UPDATE dbo.TblBotConversation
        SET ControlMode = @mode,
            ControlVersion = @ver,
            HumanLeaseUntil = @lease,
            HumanLastActivityAt = @lastAct,
            TakeoverSource = @source,
            TakenOverByUserID = @userId,
            HandoffReason = @reason,
            HandoffRequestedAt = @reqAt,
            LastHumanMessageID = @lastHuman,
            LastBotMessageID = @lastBot,
            LastCustomerMessageID = @lastCust,
            UnreadCount = @unread,
            UpdatedAt = SYSUTCDATETIME()
        WHERE ConversationID = @id
      `);

    if (input.event) {
      await new sql.Request(tx)
        .input('cid', sql.BigInt, input.next.conversationId)
        .input('prev', sql.NVarChar(20), input.event.previousMode)
        .input('neu', sql.NVarChar(20), input.event.newMode)
        .input('src', sql.NVarChar(40), input.event.source)
        .input('reason', sql.NVarChar(200), input.event.reason)
        .input('actor', sql.Int, input.event.actorUserId)
        .input('msg', sql.BigInt, input.event.relatedMessageId)
        .input('ver', sql.Int, input.event.controlVersion)
        .query(`
          INSERT INTO dbo.TblBotConversationControlEvent
            (ConversationID, PreviousMode, NewMode, Source, Reason, ActorUserID, RelatedMessageID, ControlVersion)
          VALUES (@cid, @prev, @neu, @src, @reason, @actor, @msg, @ver)
        `);
    }

    await tx.commit();
    return { ok: true };
  } catch (err) {
    try { await tx.rollback(); } catch { /* ignore */ }
    throw err;
  }
}

export async function persistControlFieldsNoVersion(next: ConversationControlState): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, next.conversationId)
    .input('lease', sql.DateTime2, next.humanLeaseUntil ? new Date(next.humanLeaseUntil) : null)
    .input('lastAct', sql.DateTime2, next.humanLastActivityAt ? new Date(next.humanLastActivityAt) : null)
    .input('source', sql.NVarChar(40), next.takeoverSource)
    .input('lastHuman', sql.BigInt, next.lastHumanMessageId)
    .input('lastCust', sql.BigInt, next.lastCustomerMessageId)
    .input('unread', sql.Int, next.unreadCount)
    .query(`
      UPDATE dbo.TblBotConversation
      SET HumanLeaseUntil = @lease,
          HumanLastActivityAt = @lastAct,
          TakeoverSource = COALESCE(@source, TakeoverSource),
          LastHumanMessageID = @lastHuman,
          LastCustomerMessageID = @lastCust,
          UnreadCount = @unread,
          UpdatedAt = SYSUTCDATETIME()
      WHERE ConversationID = @id
    `);
}

export async function markConversationRead(conversationId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, conversationId)
    .query(`
      UPDATE dbo.TblBotConversation
      SET UnreadCount = 0, LastReadAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
      WHERE ConversationID = @id
    `);
}

export async function listExpiredHandoffConversations(now: Date): Promise<ConversationControlState[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('now', sql.DateTime2, now)
    .query(`
      SELECT ${CONTROL_SELECT}
      FROM dbo.TblBotConversation
      WHERE ControlMode IN (N'HUMAN', N'HUMAN_REQUESTED')
        AND (HumanLeaseUntil IS NULL OR HumanLeaseUntil <= @now)
    `);
  return (result.recordset as Raw[]).map(mapControlState);
}

export async function tryInsertResumeClaim(input: {
  conversationId: number;
  latestCustomerMessageId: number;
  claimKey: string;
}): Promise<{ claimed: boolean }> {
  const pool = await getPool();
  try {
    await pool
      .request()
      .input('cid', sql.BigInt, input.conversationId)
      .input('mid', sql.BigInt, input.latestCustomerMessageId)
      .input('key', sql.NVarChar(80), input.claimKey)
      .query(`
        INSERT INTO dbo.TblBotConversationResumeClaim
          (ConversationID, LatestCustomerMessageID, ClaimKey)
        VALUES (@cid, @mid, @key)
      `);
    return { claimed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UQ_TblBotConversationResumeClaim|UNIQUE KEY|duplicate/i.test(msg)) {
      return { claimed: false };
    }
    throw err;
  }
}
