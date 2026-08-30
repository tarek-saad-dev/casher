import { getPool, sql } from '@/lib/db';
import {
  matchesInboxFilter,
  matchesInboxSearch,
  sortInboxItems,
  type InboxFilter,
  type InboxListItem,
} from '../domain/inboxRanking';
import {
  isConversationControlMode,
  isHandoffTakeoverSource,
  isMessageActorOrigin,
  type ConversationControlMode,
  type MessageActorOrigin,
} from '../domain/types';

export type InboxMessageItem = {
  messageId: number;
  direction: 'inbound' | 'outbound';
  origin: MessageActorOrigin;
  text: string | null;
  occurredAt: string;
  deliveryStatus: string | null;
};

export type InboxConversationDetail = InboxListItem & {
  messages: InboxMessageItem[];
  humanLeaseUntil: string | null;
};

function toIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return new Date(0).toISOString();
  return String(value);
}

export async function listWhatsAppInbox(input: {
  filter?: InboxFilter;
  q?: string;
  limit?: number;
}): Promise<{ items: InboxListItem[] }> {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 80)));
  const pool = await getPool();
  const result = await pool.request().input('limit', sql.Int, limit).query(`
    SELECT TOP (@limit)
      c.ConversationID,
      c.Phone,
      LTRIM(RTRIM(ISNULL(cl.Name, N''))) AS DisplayName,
      c.ControlMode,
      ISNULL(c.ControlVersion, 1) AS ControlVersion,
      c.TakeoverSource,
      c.TakenOverByUserID,
      LTRIM(RTRIM(ISNULL(u.UserName, N''))) AS TakenOverByName,
      ISNULL(c.UnreadCount, 0) AS UnreadCount,
      c.LastMessageAt,
      (
        SELECT TOP 1 m.Text
        FROM dbo.TblBotMessage m
        WHERE m.ConversationID = c.ConversationID
        ORDER BY m.OccurredAt DESC, m.MessageID DESC
      ) AS LastMessagePreview
    FROM dbo.TblBotConversation c
    LEFT JOIN dbo.TblClient cl ON cl.ClientID = c.ClientID
    LEFT JOIN dbo.TblUser u ON u.UserID = c.TakenOverByUserID
    WHERE c.Channel = N'whatsapp'
    ORDER BY c.LastMessageAt DESC, c.ConversationID DESC
  `);

  const mapped: InboxListItem[] = (result.recordset as Array<Record<string, unknown>>).map((row) => {
    const mode = isConversationControlMode(String(row.ControlMode))
      ? (row.ControlMode as ConversationControlMode)
      : 'BOT';
    return {
      conversationId: Number(row.ConversationID),
      phone: String(row.Phone),
      displayName: String(row.DisplayName ?? '').trim() || null,
      lastMessagePreview: row.LastMessagePreview != null ? String(row.LastMessagePreview) : null,
      lastMessageAt: toIso(row.LastMessageAt as Date | string),
      unreadCount: Number(row.UnreadCount ?? 0),
      mode,
      takeoverSource:
        row.TakeoverSource && isHandoffTakeoverSource(String(row.TakeoverSource))
          ? String(row.TakeoverSource)
          : null,
      takenOverByUserId: row.TakenOverByUserID == null ? null : Number(row.TakenOverByUserID),
      takenOverByName: String(row.TakenOverByName ?? '').trim() || null,
      controlVersion: Number(row.ControlVersion ?? 1),
    };
  });

  const filter = input.filter ?? 'all';
  const q = input.q ?? '';
  const filtered = mapped.filter(
    (item) => matchesInboxFilter(item, filter) && matchesInboxSearch(item, q),
  );
  return { items: sortInboxItems(filtered) };
}

export async function getWhatsAppInboxConversation(input: {
  conversationId: number;
  afterMessageId?: number | null;
  limit?: number;
}): Promise<InboxConversationDetail | null> {
  const pool = await getPool();
  const head = await pool
    .request()
    .input('id', sql.BigInt, input.conversationId)
    .query(`
      SELECT
        c.ConversationID,
        c.Phone,
        LTRIM(RTRIM(ISNULL(cl.Name, N''))) AS DisplayName,
        c.ControlMode,
        ISNULL(c.ControlVersion, 1) AS ControlVersion,
        c.TakeoverSource,
        c.TakenOverByUserID,
        LTRIM(RTRIM(ISNULL(u.UserName, N''))) AS TakenOverByName,
        ISNULL(c.UnreadCount, 0) AS UnreadCount,
        c.LastMessageAt,
        c.HumanLeaseUntil,
        CAST(NULL AS NVARCHAR(MAX)) AS LastMessagePreview
      FROM dbo.TblBotConversation c
      LEFT JOIN dbo.TblClient cl ON cl.ClientID = c.ClientID
      LEFT JOIN dbo.TblUser u ON u.UserID = c.TakenOverByUserID
      WHERE c.ConversationID = @id
    `);
  const row = head.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const mode = isConversationControlMode(String(row.ControlMode))
    ? (row.ControlMode as ConversationControlMode)
    : 'BOT';
  const item: InboxListItem = {
    conversationId: Number(row.ConversationID),
    phone: String(row.Phone),
    displayName: String(row.DisplayName ?? '').trim() || null,
    lastMessagePreview: null,
    lastMessageAt: toIso(row.LastMessageAt as Date | string),
    unreadCount: Number(row.UnreadCount ?? 0),
    mode,
    takeoverSource:
      row.TakeoverSource && isHandoffTakeoverSource(String(row.TakeoverSource))
        ? String(row.TakeoverSource)
        : null,
    takenOverByUserId: row.TakenOverByUserID == null ? null : Number(row.TakenOverByUserID),
    takenOverByName: String(row.TakenOverByName ?? '').trim() || null,
    controlVersion: Number(row.ControlVersion ?? 1),
  };

  const limit = Math.max(1, Math.min(300, Math.floor(input.limit ?? 120)));
  const after = input.afterMessageId != null ? Number(input.afterMessageId) : 0;
  const msgs = await pool
    .request()
    .input('id', sql.BigInt, input.conversationId)
    .input('after', sql.BigInt, after)
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        m.MessageID,
        m.Direction,
        m.Origin,
        m.Text,
        m.OccurredAt,
        o.Status AS DeliveryStatus
      FROM dbo.TblBotMessage m
      LEFT JOIN dbo.TblMessageOutbox o
        ON o.IdempotencyKey = CONCAT(
          N'whatsapp-human-erp:',
          CAST(m.ConversationID AS NVARCHAR(30)),
          N':',
          CAST(m.MessageID AS NVARCHAR(30))
        )
      WHERE m.ConversationID = @id
        AND (@after = 0 OR m.MessageID > @after)
      ORDER BY m.OccurredAt ASC, m.MessageID ASC
    `);

  const messages: InboxMessageItem[] = (msgs.recordset as Array<Record<string, unknown>>).map((m) => {
    const direction = m.Direction === 'outbound' ? 'outbound' : 'inbound';
    const originRaw = m.Origin != null ? String(m.Origin) : null;
    const origin: MessageActorOrigin =
      originRaw && isMessageActorOrigin(originRaw)
        ? originRaw
        : direction === 'outbound'
          ? 'BOT'
          : 'CUSTOMER';
    return {
      messageId: Number(m.MessageID),
      direction,
      origin,
      text: m.Text != null ? String(m.Text) : null,
      occurredAt: toIso(m.OccurredAt as Date | string),
      deliveryStatus: m.DeliveryStatus != null ? String(m.DeliveryStatus) : null,
    };
  });

  return {
    ...item,
    humanLeaseUntil: row.HumanLeaseUntil != null ? toIso(row.HumanLeaseUntil as Date | string) : null,
    messages,
  };
}

export async function resolveUserDisplayName(userId: number): Promise<string | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, userId)
    .query(`SELECT TOP 1 LTRIM(RTRIM(ISNULL(UserName, N''))) AS UserName FROM dbo.TblUser WHERE UserID = @id`);
  const name = String(result.recordset[0]?.UserName ?? '').trim();
  return name || null;
}
