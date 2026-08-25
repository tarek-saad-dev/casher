/**
 * Access to dbo.TblMessageTemplate.
 * Runtime sale lookup stays active-only. Admin writes are branch-scoped overrides.
 */
import { getPool, sql } from '@/lib/db';
import { MessageTemplateAdminError, type MessageTemplateSource } from '../../domain/templateTypes';

export type MessageTemplateLookupInput = {
  channel: string;
  templateKey: string;
  language: string;
  branchId?: number | null;
};

export type MessageTemplateLookupResult = {
  content: string;
  source: Extract<MessageTemplateSource, 'branch_db' | 'global_db'>;
};

export type MessageTemplateStoredRow = {
  id: number;
  templateKey: string;
  channel: string;
  branchId: number | null;
  language: string;
  content: string;
  isActive: boolean;
  version: number;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt?: string;
};

type RawTemplateRow = {
  ID: number;
  TemplateKey: string;
  Channel: string;
  BranchID: number | null;
  Language: string;
  Content: string;
  IsActive: boolean | number;
  Version: number;
  CreatedByUserID: number | null;
  UpdatedByUserID: number | null;
  CreatedAt: Date | string;
  UpdatedAt: Date | string | null;
};

const TEMPLATE_ROW_COLUMNS = `
  [ID],
  [TemplateKey],
  [Channel],
  [BranchID],
  [Language],
  [Content],
  [IsActive],
  [Version],
  [CreatedByUserID],
  [UpdatedByUserID],
  [CreatedAt],
  [UpdatedAt]
`;

const TEMPLATE_OUTPUT_COLUMNS = TEMPLATE_ROW_COLUMNS.replace(/\[/g, 'INSERTED.[');

function toIso(value: Date | string | null | undefined): string | undefined {
  if (value == null || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function mapMessageTemplateRow(row: RawTemplateRow): MessageTemplateStoredRow {
  const createdAt = toIso(row.CreatedAt) ?? new Date(0).toISOString();
  const updatedAt = toIso(row.UpdatedAt);
  return {
    id: Number(row.ID),
    templateKey: String(row.TemplateKey),
    channel: String(row.Channel),
    branchId: row.BranchID == null ? null : Number(row.BranchID),
    language: String(row.Language),
    content: String(row.Content ?? ''),
    isActive: row.IsActive === true || row.IsActive === 1,
    version: Number(row.Version),
    createdByUserId: row.CreatedByUserID == null ? null : Number(row.CreatedByUserID),
    updatedByUserId: row.UpdatedByUserID == null ? null : Number(row.UpdatedByUserID),
    createdAt,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export async function lookupActiveMessageTemplate(
  input: MessageTemplateLookupInput,
): Promise<MessageTemplateLookupResult | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('channel', sql.NVarChar(40), input.channel)
    .input('templateKey', sql.NVarChar(100), input.templateKey)
    .input('language', sql.NVarChar(10), input.language)
    .input('branchId', sql.Int, input.branchId ?? null)
    .query<{ Content: string; BranchID: number | null }>(`
      SELECT TOP (1) [Content], [BranchID]
      FROM [dbo].[TblMessageTemplate]
      WHERE [Channel] = @channel
        AND [TemplateKey] = @templateKey
        AND [Language] = @language
        AND [IsActive] = 1
        AND [Content] IS NOT NULL
        AND LTRIM(RTRIM([Content])) <> N''
        AND (
          (@branchId IS NOT NULL AND [BranchID] = @branchId)
          OR [BranchID] IS NULL
        )
      ORDER BY CASE WHEN [BranchID] IS NOT NULL THEN 0 ELSE 1 END,
               [Version] DESC,
               [ID] DESC
    `);

  const row = result.recordset[0];
  const content = typeof row?.Content === 'string' ? row.Content.trim() : '';
  if (!content) return null;

  return {
    content: row.Content,
    source: row.BranchID != null ? 'branch_db' : 'global_db',
  };
}

export async function listMessageTemplateRows(input: {
  channel: string;
  templateKeys: string[];
  language: string;
  branchId: number;
}): Promise<MessageTemplateStoredRow[]> {
  if (input.templateKeys.length === 0) return [];

  const pool = await getPool();
  const request = pool
    .request()
    .input('channel', sql.NVarChar(40), input.channel)
    .input('language', sql.NVarChar(10), input.language)
    .input('branchId', sql.Int, input.branchId);

  input.templateKeys.forEach((key, index) => {
    request.input(`k${index}`, sql.NVarChar(100), key);
  });
  const inList = input.templateKeys.map((_, index) => `@k${index}`).join(', ');

  const result = await request.query<RawTemplateRow>(`
    SELECT ${TEMPLATE_ROW_COLUMNS}
    FROM [dbo].[TblMessageTemplate]
    WHERE [Channel] = @channel
      AND [Language] = @language
      AND [TemplateKey] IN (${inList})
      AND ([BranchID] = @branchId OR [BranchID] IS NULL)
    ORDER BY [TemplateKey],
             CASE WHEN [BranchID] IS NOT NULL THEN 0 ELSE 1 END,
             CASE WHEN [IsActive] = 1 THEN 0 ELSE 1 END,
             [Version] DESC,
             [ID] DESC
  `);

  return result.recordset.map(mapMessageTemplateRow);
}

function isDuplicateActiveBranchOverride(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /UX_TblMessageTemplate_ActiveBranch/i.test(message) ||
    /Cannot insert duplicate key/i.test(message)
  );
}

async function selectLockedBranchOverrideRows(
  tx: InstanceType<typeof sql.Transaction>,
  input: {
    channel: string;
    templateKey: string;
    language: string;
    branchId: number;
  },
): Promise<MessageTemplateStoredRow[]> {
  const result = await new sql.Request(tx)
    .input('channel', sql.NVarChar(40), input.channel)
    .input('templateKey', sql.NVarChar(100), input.templateKey)
    .input('language', sql.NVarChar(10), input.language)
    .input('branchId', sql.Int, input.branchId)
    .query<RawTemplateRow>(`
      SELECT ${TEMPLATE_ROW_COLUMNS}
      FROM [dbo].[TblMessageTemplate] WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      WHERE [Channel] = @channel
        AND [TemplateKey] = @templateKey
        AND [Language] = @language
        AND [BranchID] = @branchId
      ORDER BY CASE WHEN [IsActive] = 1 THEN 0 ELSE 1 END,
               [Version] DESC,
               [ID] DESC
    `);
  return result.recordset.map(mapMessageTemplateRow);
}

export async function upsertBranchMessageTemplateOverride(input: {
  channel: 'whatsapp';
  templateKey: string;
  language: string;
  branchId: number;
  content: string;
  userId: number;
}): Promise<MessageTemplateStoredRow> {
  if (!Number.isInteger(input.branchId) || input.branchId <= 0) {
    throw new Error('branchId is required for a branch override');
  }

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const existing = await selectLockedBranchOverrideRows(tx, input);
    const target = existing[0] ?? null;

    let saved: MessageTemplateStoredRow;
    if (target) {
      const updated = await new sql.Request(tx)
        .input('id', sql.Int, target.id)
        .input('content', sql.NVarChar(sql.MAX), input.content)
        .input('userId', sql.Int, input.userId)
        .query<RawTemplateRow>(`
          UPDATE [dbo].[TblMessageTemplate]
          SET
            [Content] = @content,
            [IsActive] = 1,
            [Version] = [Version] + 1,
            [UpdatedByUserID] = @userId,
            [UpdatedAt] = SYSUTCDATETIME()
          OUTPUT ${TEMPLATE_OUTPUT_COLUMNS}
          WHERE [ID] = @id
            AND [BranchID] IS NOT NULL
        `);
      saved = mapMessageTemplateRow(updated.recordset[0]);
    } else {
      const inserted = await new sql.Request(tx)
        .input('templateKey', sql.NVarChar(100), input.templateKey)
        .input('channel', sql.NVarChar(40), input.channel)
        .input('branchId', sql.Int, input.branchId)
        .input('language', sql.NVarChar(10), input.language)
        .input('content', sql.NVarChar(sql.MAX), input.content)
        .input('userId', sql.Int, input.userId)
        .query<RawTemplateRow>(`
          INSERT INTO [dbo].[TblMessageTemplate] (
            [TemplateKey],
            [Channel],
            [BranchID],
            [Language],
            [Content],
            [IsActive],
            [Version],
            [CreatedByUserID],
            [CreatedAt]
          )
          OUTPUT ${TEMPLATE_OUTPUT_COLUMNS}
          VALUES (
            @templateKey,
            @channel,
            @branchId,
            @language,
            @content,
            1,
            1,
            @userId,
            SYSUTCDATETIME()
          )
        `);
      saved = mapMessageTemplateRow(inserted.recordset[0]);
    }

    await tx.commit();
    return saved;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore rollback failure
    }
    if (isDuplicateActiveBranchOverride(err)) {
      throw new MessageTemplateAdminError(
        'تعذر حفظ القالب بسبب تعارض متزامن، حاول مرة أخرى',
        409,
        'CONCURRENT_UPDATE',
      );
    }
    throw err;
  }
}

export async function deactivateBranchMessageTemplateOverride(input: {
  channel: 'whatsapp';
  templateKey: string;
  language: string;
  branchId: number;
  userId: number;
}): Promise<{ changed: boolean; row: MessageTemplateStoredRow | null }> {
  if (!Number.isInteger(input.branchId) || input.branchId <= 0) {
    throw new Error('branchId is required for a branch override');
  }

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const existing = await selectLockedBranchOverrideRows(tx, input);
    const active = existing.find((row) => row.isActive) ?? null;
    if (!active) {
      await tx.commit();
      return { changed: false, row: existing[0] ?? null };
    }

    const updated = await new sql.Request(tx)
      .input('id', sql.Int, active.id)
      .input('userId', sql.Int, input.userId)
      .query<RawTemplateRow>(`
        UPDATE [dbo].[TblMessageTemplate]
        SET
          [IsActive] = 0,
          [Version] = [Version] + 1,
          [UpdatedByUserID] = @userId,
          [UpdatedAt] = SYSUTCDATETIME()
        OUTPUT ${TEMPLATE_OUTPUT_COLUMNS}
        WHERE [ID] = @id
          AND [BranchID] IS NOT NULL
          AND [IsActive] = 1
      `);

    await tx.commit();
    const row = updated.recordset[0] ? mapMessageTemplateRow(updated.recordset[0]) : active;
    return { changed: Boolean(updated.recordset[0]), row };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore rollback failure
    }
    throw err;
  }
}
