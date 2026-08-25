import { getPool, sql } from '@/lib/db';
import type {
  CampaignMessageMode,
  CampaignRecipientRow,
  CampaignRecipientStatus,
  CampaignRow,
  CampaignStatus,
  CreateCampaignInput,
} from '../domain/types';
import { serializeAudienceCriteria } from '../domain/types';

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function mapCampaignRow(row: Record<string, unknown>): CampaignRow {
  return {
    id: Number(row.ID),
    name: String(row.Name ?? ''),
    status: String(row.Status) as CampaignStatus,
    messageMode: String(row.MessageMode) as CampaignMessageMode,
    templateKey: row.TemplateKey != null ? String(row.TemplateKey) : null,
    customMessage: row.CustomMessage != null ? String(row.CustomMessage) : null,
    audienceJson: String(row.AudienceJson ?? '{}'),
    branchId: row.BranchID != null ? Number(row.BranchID) : null,
    totalRecipients: Number(row.TotalRecipients ?? 0),
    sentCount: Number(row.SentCount ?? 0),
    failedCount: Number(row.FailedCount ?? 0),
    pendingCount: Number(row.PendingCount ?? 0),
    createdByUserId: row.CreatedByUserID != null ? Number(row.CreatedByUserID) : null,
    createdAt: toIso(row.CreatedAt as Date | string) ?? new Date().toISOString(),
    scheduledAt: toIso(row.ScheduledAt as Date | string | null),
    startedAt: toIso(row.StartedAt as Date | string | null),
    completedAt: toIso(row.CompletedAt as Date | string | null),
    cancelledAt: toIso(row.CancelledAt as Date | string | null),
    lastError: row.LastError != null ? String(row.LastError) : null,
  };
}

function mapRecipientRow(row: Record<string, unknown>): CampaignRecipientRow {
  return {
    id: Number(row.ID),
    campaignId: Number(row.CampaignID),
    customerId: row.CustomerID != null ? Number(row.CustomerID) : null,
    customerName: row.CustomerName != null ? String(row.CustomerName) : null,
    phone: String(row.Phone ?? ''),
    messageContent: String(row.MessageContent ?? ''),
    idempotencyKey: String(row.IdempotencyKey ?? ''),
    outboxMessageId: row.OutboxMessageID != null ? Number(row.OutboxMessageID) : null,
    status: String(row.Status) as CampaignRecipientStatus,
    lastError: row.LastError != null ? String(row.LastError) : null,
    createdAt: toIso(row.CreatedAt as Date | string) ?? new Date().toISOString(),
    sentAt: toIso(row.SentAt as Date | string | null),
  };
}

export async function insertCampaign(input: CreateCampaignInput): Promise<CampaignRow> {
  const pool = await getPool();
  const audienceJson = serializeAudienceCriteria(input.audience);

  const result = await pool
    .request()
    .input('name', sql.NVarChar(200), input.name.trim())
    .input('messageMode', sql.NVarChar(20), input.messageMode)
    .input('templateKey', sql.NVarChar(100), input.templateKey ?? null)
    .input('customMessage', sql.NVarChar(sql.MAX), input.customMessage ?? null)
    .input('audienceJson', sql.NVarChar(sql.MAX), audienceJson)
    .input('branchId', sql.Int, input.branchId ?? null)
    .input('createdByUserId', sql.Int, input.createdByUserId)
    .input('scheduledAt', sql.DateTime2, input.scheduledAt ?? null)
    .query(`
      INSERT INTO dbo.TblWhatsAppCampaign (
        Name, Status, MessageMode, TemplateKey, CustomMessage, AudienceJson,
        BranchID, CreatedByUserID, ScheduledAt
      )
      OUTPUT INSERTED.*
      VALUES (
        @name, N'draft', @messageMode, @templateKey, @customMessage, @audienceJson,
        @branchId, @createdByUserId, @scheduledAt
      )
    `);

  return mapCampaignRow(result.recordset[0] as Record<string, unknown>);
}

export async function listCampaigns(limit = 100): Promise<CampaignRow[]> {
  const pool = await getPool();
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const result = await pool.request().input('limit', sql.Int, safeLimit).query(`
    SELECT TOP (@limit) *
    FROM dbo.TblWhatsAppCampaign
    ORDER BY CreatedAt DESC, ID DESC
  `);
  return (result.recordset ?? []).map((row) => mapCampaignRow(row as Record<string, unknown>));
}

export async function getCampaignById(id: number): Promise<CampaignRow | null> {
  const pool = await getPool();
  const result = await pool.request().input('id', sql.Int, id).query(`
    SELECT * FROM dbo.TblWhatsAppCampaign WHERE ID = @id
  `);
  const row = result.recordset?.[0];
  return row ? mapCampaignRow(row as Record<string, unknown>) : null;
}

export async function updateCampaignStatus(
  id: number,
  patch: Partial<{
    status: CampaignStatus;
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    pendingCount: number;
    startedAt: Date | null;
    completedAt: Date | null;
    cancelledAt: Date | null;
    lastError: string | null;
  }>,
): Promise<CampaignRow | null> {
  const sets: string[] = [];
  const pool = await getPool();
  const req = pool.request().input('id', sql.Int, id);

  if (patch.status != null) {
    sets.push('Status = @status');
    req.input('status', sql.NVarChar(20), patch.status);
  }
  if (patch.totalRecipients != null) {
    sets.push('TotalRecipients = @totalRecipients');
    req.input('totalRecipients', sql.Int, patch.totalRecipients);
  }
  if (patch.sentCount != null) {
    sets.push('SentCount = @sentCount');
    req.input('sentCount', sql.Int, patch.sentCount);
  }
  if (patch.failedCount != null) {
    sets.push('FailedCount = @failedCount');
    req.input('failedCount', sql.Int, patch.failedCount);
  }
  if (patch.pendingCount != null) {
    sets.push('PendingCount = @pendingCount');
    req.input('pendingCount', sql.Int, patch.pendingCount);
  }
  if (patch.startedAt !== undefined) {
    sets.push('StartedAt = @startedAt');
    req.input('startedAt', sql.DateTime2, patch.startedAt);
  }
  if (patch.completedAt !== undefined) {
    sets.push('CompletedAt = @completedAt');
    req.input('completedAt', sql.DateTime2, patch.completedAt);
  }
  if (patch.cancelledAt !== undefined) {
    sets.push('CancelledAt = @cancelledAt');
    req.input('cancelledAt', sql.DateTime2, patch.cancelledAt);
  }
  if (patch.lastError !== undefined) {
    sets.push('LastError = @lastError');
    req.input('lastError', sql.NVarChar(sql.MAX), patch.lastError);
  }

  if (sets.length === 0) return getCampaignById(id);

  const result = await req.query(`
    UPDATE dbo.TblWhatsAppCampaign
    SET ${sets.join(', ')}
    OUTPUT INSERTED.*
    WHERE ID = @id
  `);
  const row = result.recordset?.[0];
  return row ? mapCampaignRow(row as Record<string, unknown>) : null;
}

export type InsertRecipientInput = {
  campaignId: number;
  customerId: number | null;
  customerName: string | null;
  phone: string;
  messageContent: string;
  idempotencyKey: string;
};

export async function insertCampaignRecipient(
  input: InsertRecipientInput,
): Promise<CampaignRecipientRow> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('campaignId', sql.Int, input.campaignId)
    .input('customerId', sql.Int, input.customerId)
    .input('customerName', sql.NVarChar(200), input.customerName)
    .input('phone', sql.NVarChar(50), input.phone)
    .input('messageContent', sql.NVarChar(sql.MAX), input.messageContent)
    .input('idempotencyKey', sql.NVarChar(200), input.idempotencyKey)
    .query(`
      INSERT INTO dbo.TblWhatsAppCampaignRecipient (
        CampaignID, CustomerID, CustomerName, Phone, MessageContent, IdempotencyKey, Status
      )
      OUTPUT INSERTED.*
      VALUES (
        @campaignId, @customerId, @customerName, @phone, @messageContent, @idempotencyKey, N'pending'
      )
    `);
  return mapRecipientRow(result.recordset[0] as Record<string, unknown>);
}

export async function listRecipientsByCampaign(
  campaignId: number,
): Promise<CampaignRecipientRow[]> {
  const pool = await getPool();
  const result = await pool.request().input('campaignId', sql.Int, campaignId).query(`
    SELECT * FROM dbo.TblWhatsAppCampaignRecipient
    WHERE CampaignID = @campaignId
    ORDER BY ID ASC
  `);
  return (result.recordset ?? []).map((row) => mapRecipientRow(row as Record<string, unknown>));
}

export async function updateRecipient(
  id: number,
  patch: Partial<{
    status: CampaignRecipientStatus;
    outboxMessageId: number | null;
    lastError: string | null;
    sentAt: Date | null;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const pool = await getPool();
  const req = pool.request().input('id', sql.BigInt, id);

  if (patch.status != null) {
    sets.push('Status = @status');
    req.input('status', sql.NVarChar(20), patch.status);
  }
  if (patch.outboxMessageId !== undefined) {
    sets.push('OutboxMessageID = @outboxMessageId');
    req.input('outboxMessageId', sql.BigInt, patch.outboxMessageId);
  }
  if (patch.lastError !== undefined) {
    sets.push('LastError = @lastError');
    req.input('lastError', sql.NVarChar(sql.MAX), patch.lastError);
  }
  if (patch.sentAt !== undefined) {
    sets.push('SentAt = @sentAt');
    req.input('sentAt', sql.DateTime2, patch.sentAt);
  }

  if (sets.length === 0) return;

  await req.query(`
    UPDATE dbo.TblWhatsAppCampaignRecipient
    SET ${sets.join(', ')}
    WHERE ID = @id
  `);
}

export async function cancelPendingRecipients(campaignId: number): Promise<number> {
  const pool = await getPool();
  const result = await pool.request().input('campaignId', sql.Int, campaignId).query(`
    UPDATE dbo.TblWhatsAppCampaignRecipient
    SET Status = N'cancelled'
    OUTPUT INSERTED.ID
    WHERE CampaignID = @campaignId AND Status = N'pending'
  `);
  return result.recordset?.length ?? 0;
}

export async function countRecipientsByStatus(
  campaignId: number,
): Promise<Record<CampaignRecipientStatus, number>> {
  const pool = await getPool();
  const result = await pool.request().input('campaignId', sql.Int, campaignId).query(`
    SELECT Status, COUNT(*) AS cnt
    FROM dbo.TblWhatsAppCampaignRecipient
    WHERE CampaignID = @campaignId
    GROUP BY Status
  `);

  const counts: Record<CampaignRecipientStatus, number> = {
    pending: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  };

  for (const row of result.recordset ?? []) {
    const status = String((row as { Status: string }).Status) as CampaignRecipientStatus;
    if (status in counts) {
      counts[status] = Number((row as { cnt: number }).cnt);
    }
  }
  return counts;
}

export async function getRecipientByIdempotencyKey(
  idempotencyKey: string,
): Promise<CampaignRecipientRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('idempotencyKey', sql.NVarChar(200), idempotencyKey)
    .query(`
      SELECT TOP 1 * FROM dbo.TblWhatsAppCampaignRecipient
      WHERE IdempotencyKey = @idempotencyKey
    `);
  const row = result.recordset?.[0];
  return row ? mapRecipientRow(row as Record<string, unknown>) : null;
}
