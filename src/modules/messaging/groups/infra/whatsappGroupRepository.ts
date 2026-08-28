import { getPool, sql } from '@/lib/db';
import {
  isValidWhatsAppGroupEventKey,
  normalizeSubscribedEvents,
} from '../domain/eventCatalog';
import {
  isValidWhatsAppGroupInviteLink,
  normalizeWhatsAppGroupInviteLink,
} from '../domain/inviteLink';
import type {
  WhatsAppGroupEventKey,
  WhatsAppGroupInput,
  WhatsAppGroupRow,
} from '../domain/types';

export class WhatsAppGroupError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'WhatsAppGroupError';
  }
}

let tableEnsured = false;

export async function ensureWhatsAppGroupTable(): Promise<void> {
  if (tableEnsured) return;
  const pool = await getPool();
  const check = await pool.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblWhatsAppGroup'
  `);
  if (Number(check.recordset[0]?.cnt) === 0) {
    await pool.request().query(`
      CREATE TABLE [dbo].[TblWhatsAppGroup] (
        [ID]                INT            IDENTITY(1,1) NOT NULL,
        [Name]              NVARCHAR(200)  NOT NULL,
        [InviteLink]        NVARCHAR(500)  NOT NULL,
        [SubscribedEvents]  NVARCHAR(MAX)  NOT NULL
            CONSTRAINT [DF_TblWhatsAppGroup_SubscribedEvents] DEFAULT (N'[]'),
        [BranchID]          INT            NULL,
        [IsActive]          BIT            NOT NULL
            CONSTRAINT [DF_TblWhatsAppGroup_IsActive] DEFAULT (1),
        [CreatedAt]         DATETIME2(0)   NOT NULL
            CONSTRAINT [DF_TblWhatsAppGroup_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [UpdatedAt]         DATETIME2(0)   NULL,
        CONSTRAINT [PK_TblWhatsAppGroup] PRIMARY KEY CLUSTERED ([ID])
      )
    `);
  }
  tableEnsured = true;
}

function parseSubscribedEventsJson(raw: unknown): WhatsAppGroupEventKey[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    return normalizeSubscribedEvents(JSON.parse(raw));
  } catch {
    return [];
  }
}

function mapRow(row: Record<string, unknown>): WhatsAppGroupRow {
  return {
    id: Number(row.ID),
    name: String(row.Name ?? ''),
    inviteLink: String(row.InviteLink ?? ''),
    subscribedEvents: parseSubscribedEventsJson(row.SubscribedEvents),
    branchId: row.BranchID != null ? Number(row.BranchID) : null,
    isActive: row.IsActive === true || row.IsActive === 1,
    createdAt:
      row.CreatedAt instanceof Date
        ? row.CreatedAt.toISOString()
        : String(row.CreatedAt ?? ''),
    updatedAt:
      row.UpdatedAt == null
        ? null
        : row.UpdatedAt instanceof Date
          ? row.UpdatedAt.toISOString()
          : String(row.UpdatedAt),
  };
}

function validateInput(input: WhatsAppGroupInput): {
  name: string;
  inviteLink: string;
  subscribedEvents: WhatsAppGroupEventKey[];
  branchId: number | null;
  isActive: boolean;
} {
  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new WhatsAppGroupError('اسم الجروب مطلوب', 'MISSING_NAME');
  }
  if (name.length > 200) {
    throw new WhatsAppGroupError('اسم الجروب طويل جداً', 'NAME_TOO_LONG');
  }

  const inviteLink = normalizeWhatsAppGroupInviteLink(String(input.inviteLink ?? ''));
  if (!inviteLink) {
    throw new WhatsAppGroupError('رابط الجروب مطلوب', 'MISSING_INVITE_LINK');
  }
  if (!isValidWhatsAppGroupInviteLink(inviteLink)) {
    throw new WhatsAppGroupError(
      'رابط الجروب غير صالح — استخدم رابط دعوة chat.whatsapp.com',
      'INVALID_INVITE_LINK',
    );
  }

  const subscribedEvents = normalizeSubscribedEvents(input.subscribedEvents);
  if (subscribedEvents.length === 0) {
    throw new WhatsAppGroupError(
      'اختر حدث واحد على الأقل للإرسال',
      'MISSING_EVENTS',
    );
  }

  const branchId =
    typeof input.branchId === 'number' && Number.isFinite(input.branchId)
      ? input.branchId
      : null;

  return {
    name,
    inviteLink,
    subscribedEvents,
    branchId,
    isActive: input.isActive !== false,
  };
}

export async function listWhatsAppGroups(): Promise<WhatsAppGroupRow[]> {
  await ensureWhatsAppGroupTable();
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      ID, Name, InviteLink, SubscribedEvents, BranchID, IsActive, CreatedAt, UpdatedAt
    FROM dbo.TblWhatsAppGroup
    ORDER BY Name ASC, ID ASC
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapRow);
}

export async function getWhatsAppGroupById(
  id: number,
): Promise<WhatsAppGroupRow | null> {
  await ensureWhatsAppGroupTable();
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT TOP 1
        ID, Name, InviteLink, SubscribedEvents, BranchID, IsActive, CreatedAt, UpdatedAt
      FROM dbo.TblWhatsAppGroup
      WHERE ID = @id
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export async function createWhatsAppGroup(
  input: WhatsAppGroupInput,
): Promise<WhatsAppGroupRow> {
  const validated = validateInput(input);
  await ensureWhatsAppGroupTable();
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(200), validated.name)
    .input('inviteLink', sql.NVarChar(500), validated.inviteLink)
    .input('subscribedEvents', sql.NVarChar(sql.MAX), JSON.stringify(validated.subscribedEvents))
    .input('branchId', sql.Int, validated.branchId)
    .input('isActive', sql.Bit, validated.isActive ? 1 : 0)
    .query(`
      INSERT INTO dbo.TblWhatsAppGroup (Name, InviteLink, SubscribedEvents, BranchID, IsActive)
      OUTPUT INSERTED.ID, INSERTED.Name, INSERTED.InviteLink, INSERTED.SubscribedEvents,
             INSERTED.BranchID, INSERTED.IsActive, INSERTED.CreatedAt, INSERTED.UpdatedAt
      VALUES (@name, @inviteLink, @subscribedEvents, @branchId, @isActive)
    `);
  return mapRow(result.recordset[0] as Record<string, unknown>);
}

export async function updateWhatsAppGroup(
  id: number,
  input: WhatsAppGroupInput,
): Promise<WhatsAppGroupRow> {
  const existing = await getWhatsAppGroupById(id);
  if (!existing) {
    throw new WhatsAppGroupError('الجروب غير موجود', 'NOT_FOUND', 404);
  }
  const validated = validateInput(input);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar(200), validated.name)
    .input('inviteLink', sql.NVarChar(500), validated.inviteLink)
    .input('subscribedEvents', sql.NVarChar(sql.MAX), JSON.stringify(validated.subscribedEvents))
    .input('branchId', sql.Int, validated.branchId)
    .input('isActive', sql.Bit, validated.isActive ? 1 : 0)
    .query(`
      UPDATE dbo.TblWhatsAppGroup
      SET
        Name = @name,
        InviteLink = @inviteLink,
        SubscribedEvents = @subscribedEvents,
        BranchID = @branchId,
        IsActive = @isActive,
        UpdatedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.ID, INSERTED.Name, INSERTED.InviteLink, INSERTED.SubscribedEvents,
             INSERTED.BranchID, INSERTED.IsActive, INSERTED.CreatedAt, INSERTED.UpdatedAt
      WHERE ID = @id
    `);
  return mapRow(result.recordset[0] as Record<string, unknown>);
}

export async function deleteWhatsAppGroup(id: number): Promise<void> {
  await ensureWhatsAppGroupTable();
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`DELETE FROM dbo.TblWhatsAppGroup WHERE ID = @id`);
  if (result.rowsAffected[0] === 0) {
    throw new WhatsAppGroupError('الجروب غير موجود', 'NOT_FOUND', 404);
  }
}

/** Active groups subscribed to an event, optionally scoped to a branch. */
export async function listActiveGroupsForEvent(
  eventKey: WhatsAppGroupEventKey,
  branchId?: number | null,
): Promise<WhatsAppGroupRow[]> {
  if (!isValidWhatsAppGroupEventKey(eventKey)) return [];
  const all = await listWhatsAppGroups();
  return all.filter((g) => {
    if (!g.isActive) return false;
    if (!g.subscribedEvents.includes(eventKey)) return false;
    if (g.branchId == null) return true;
    if (branchId == null) return true;
    return g.branchId === branchId;
  });
}
