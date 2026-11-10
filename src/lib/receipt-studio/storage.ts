import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  COMPACT_CUT_RECEIPT_V1,
  validateReceiptTemplateV1,
  type ReceiptTemplateV1,
} from './template';

export type StudioScope = 'tenant' | 'branch';
export type StudioHistory = {
  version: number; action: 'publish' | 'rollback'; actorUserId: number; createdAt: string;
};
export type StudioState = {
  draft: ReceiptTemplateV1;
  draftRevision: number;
  published: ReceiptTemplateV1 | null;
  publishedVersion: number;
  history: StudioHistory[];
  hasOverride: boolean;
};
type StudioRow = {
  DraftJson: string | null; DraftRevision: number;
  PublishedJson: string | null; PublishedVersion: number;
};

export class StudioError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'STUDIO_ERROR') {
    super(message);
    this.name = 'StudioError';
  }
}
export function branchScope(scope: StudioScope, currentBranchId: number): number {
  if (scope === 'tenant') return 0;
  if (scope === 'branch' && Number.isSafeInteger(currentBranchId) && currentBranchId > 0) return currentBranchId;
  throw new StudioError('Invalid studio branch selection', 400, 'BAD_BRANCH');
}
export function parseScope(input: unknown): StudioScope {
  if (input === 'tenant' || input === 'branch') return input;
  throw new StudioError('scope must be tenant or branch', 400, 'BAD_SCOPE');
}
function parseTemplate(text: string | null): ReceiptTemplateV1 | null {
  if (!text) return null;
  try {
    const validated = validateReceiptTemplateV1(JSON.parse(text));
    return validated.ok ? validated.template : null;
  } catch { return null; }
}
export async function assertStudioSchema(): Promise<void> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.ReceiptStudioTemplate', N'U') IS NOT NULL
        AND OBJECT_ID(N'dbo.ReceiptStudioVersion', N'U') IS NOT NULL
        AND OBJECT_ID(N'dbo.ReceiptStudioAsset', N'U') IS NOT NULL
      THEN 1 ELSE 0 END AS Ready
  `);
  if (result.recordset[0]?.Ready !== 1) {
    throw new StudioError('Receipt Studio database migration has not been applied', 503, 'SCHEMA_NOT_READY');
  }
}
function args(req: sql.Request, tenantId: string, branch: number) {
  return req
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('branch', sql.Int, branch)
    .input('kind', sql.VarChar(24), 'invoice');
}
export async function readStudioState(tenantId: string, scope: number): Promise<StudioState> {
  await assertStudioSchema();
  const pool = await getPool();
  const [rows, versions] = await Promise.all([
    args(pool.request(), tenantId, scope).query(`
      SELECT DraftJson, DraftRevision, PublishedJson, PublishedVersion
      FROM dbo.ReceiptStudioTemplate
      WHERE TenantId=@tenantId AND BranchScope=@branch AND ReceiptType=@kind
    `),
    args(pool.request(), tenantId, scope).query(`
      SELECT TOP (25) Version, Action, ActorUserId, CreatedAt
      FROM dbo.ReceiptStudioVersion
      WHERE TenantId=@tenantId AND BranchScope=@branch AND ReceiptType=@kind
      ORDER BY Version DESC
    `),
  ]);
  const row: StudioRow | undefined = rows.recordset[0];
  return {
    draft: parseTemplate(row?.DraftJson ?? null) ?? structuredClone(COMPACT_CUT_RECEIPT_V1),
    draftRevision: row?.DraftRevision ?? 0,
    published: parseTemplate(row?.PublishedJson ?? null),
    publishedVersion: row?.PublishedVersion ?? 0,
    hasOverride: Boolean(row?.PublishedJson),
    history: versions.recordset.map((x: { Version: number; Action: 'publish' | 'rollback'; ActorUserId: number; CreatedAt: Date }) => ({
      version: x.Version, action: x.Action, actorUserId: x.ActorUserId, createdAt: x.CreatedAt.toISOString(),
    })),
  };
}
export async function saveStudioDraft(
  tenantId: string, branch: number, actor: number, expectedRevision: number, template: unknown,
): Promise<number> {
  const validated = validateReceiptTemplateV1(template);
  if (!validated.ok) throw new StudioError(validated.errors[0] ?? 'Invalid receipt design', 400, 'INVALID_TEMPLATE');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new StudioError('Invalid draft revision');
  await assertStudioSchema();
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const req = args(new sql.Request(tx), tenantId, branch);
    const existing = await req.query(`
      SELECT DraftRevision FROM dbo.ReceiptStudioTemplate WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId=@tenantId AND BranchScope=@branch AND ReceiptType=@kind
    `);
    const revision = existing.recordset[0]?.DraftRevision ?? 0;
    if (revision !== expectedRevision) throw new StudioError('Design changed in another session. Reload before saving.', 409, 'REVISION_CONFLICT');
    const next = revision + 1;
    const content = JSON.stringify(validated.template);
    if (existing.recordset.length) {
      await args(new sql.Request(tx), tenantId, branch)
        .input('json', sql.NVarChar(sql.MAX), content)
        .input('actor', sql.Int, actor)
        .input('next', sql.Int, next)
        .query(`UPDATE dbo.ReceiptStudioTemplate SET DraftJson=@json, DraftRevision=@next, UpdatedByUserId=@actor, UpdatedAt=SYSUTCDATETIME()
          WHERE TenantId=@tenantId AND BranchScope=@branch AND ReceiptType=@kind`);
    } else {
      await args(new sql.Request(tx), tenantId, branch)
        .input('json', sql.NVarChar(sql.MAX), content)
        .input('actor', sql.Int, actor)
        .input('next', sql.Int, next)
        .query(`INSERT dbo.ReceiptStudioTemplate
          (TenantId, BranchScope, ReceiptType, DraftJson, DraftRevision, UpdatedByUserId)
          VALUES (@tenantId, @branch, @kind, @json, @next, @actor)`);
    }
    await tx.commit();
    return next;
  } catch (error) { await tx.rollback(); throw error; }
}
async function assertAssets(tenantId: string, design: ReceiptTemplateV1, tx: sql.Transaction) {
  const ids = [...new Set(design.blocks.filter((b) => b.kind === 'image' && b.enabled).map((b) => b.assetId!))];
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StudioError('Image must be uploaded from Receipt Studio', 400, 'INVALID_ASSET');
    const match = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('assetId', sql.UniqueIdentifier, id)
      .query(`SELECT 1 AS Found FROM dbo.ReceiptStudioAsset WHERE TenantId=@tenantId AND AssetId=@assetId`);
    if (!match.recordset.length) throw new StudioError('Missing or unauthorized receipt image', 400, 'INVALID_ASSET');
  }
}
async function publishSnapshot(tenantId: string, branch: number, actor: number, input: { action: 'publish' | 'rollback'; expectedDraftRevision?: number; restoreVersion?: number }): Promise<number> {
  await assertStudioSchema();
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const selected = await args(new sql.Request(tx), tenantId, branch).query(`
      SELECT DraftJson, DraftRevision, PublishedVersion FROM dbo.ReceiptStudioTemplate WITH(UPDLOCK, HOLDLOCK)
      WHERE TenantId=@tenantId AND BranchScope=@branch AND ReceiptType=@kind
    `);
    if (!selected.recordset.length) throw new StudioError('Save your design first', 400, 'NO_DRAFT');
    const row: StudioRow = selected.recordset[0];
    let template: ReceiptTemplateV1 | null;
    if (input.action === 'publish') {
      if (row.DraftRevision !== input.expectedDraftRevision) throw new StudioError('Draft was changed; reload', 409, 'REVISION_CONFLICT');
      template = parseTemplate(row.DraftJson);
    } else {
      const version = await args(new sql.Request(tx), tenantId, branch)
        .input('restoreVersion', sql.Int, input.restoreVersion ?? -1)
        .query(`SELECT SnapshotJson FROM dbo.ReceiptStudioVersion
          WHERE TenantId=@tenantId AND BranchScope=@branch AND ReceiptType=@kind AND Version=@restoreVersion`);
      template = parseTemplate(version.recordset[0]?.SnapshotJson ?? null);
    }
    if (!template) throw new StudioError('Design is missing or invalid', 400, 'INVALID_TEMPLATE');
    await assertAssets(tenantId, template, tx);
    const published = row.PublishedVersion + 1;
    const json = JSON.stringify(template);
    await args(new sql.Request(tx), tenantId, branch)
      .input('version', sql.Int, published).input('json', sql.NVarChar(sql.MAX), json)
      .input('actor', sql.Int, actor).input('action', sql.VarChar(16), input.action)
      .query(`INSERT INTO dbo.ReceiptStudioVersion (TenantId, BranchScope, ReceiptType, Version, SnapshotJson, Action, ActorUserId)
        VALUES (@tenantId, @branch, @kind, @version, @json, @action, @actor)`);
    await args(new sql.Request(tx), tenantId, branch)
      .input('version', sql.Int, published).input('json', sql.NVarChar(sql.MAX), json)
      .input('actor', sql.Int, actor)
      .query(`UPDATE dbo.ReceiptStudioTemplate
        SET PublishedJson=@json, PublishedVersion=@version, UpdatedByUserId=@actor, UpdatedAt=SYSUTCDATETIME()
        WHERE TenantId=@tenantId AND BranchScope=@branch AND ReceiptType=@kind`);
    await tx.commit();
    return published;
  } catch (error) { await tx.rollback(); throw error; }
}
export async function publishStudio(tenantId: string, branch: number, actor: number, expectedDraftRevision: number) {
  return publishSnapshot(tenantId, branch, actor, { action: 'publish', expectedDraftRevision });
}
export async function rollbackStudio(tenantId: string, branch: number, actor: number, restoreVersion: number) {
  if (!Number.isSafeInteger(restoreVersion) || restoreVersion < 1) throw new StudioError('Invalid version');
  return publishSnapshot(tenantId, branch, actor, { action: 'rollback', restoreVersion });
}
export async function resolvePublishedStudio(tenantId: string, activeBranch: number): Promise<{ template: ReceiptTemplateV1; branchScope: number; version: number } | null> {
  await assertStudioSchema();
  const pool = await getPool();
  const result = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('branch', sql.Int, activeBranch)
    .query(`
      SELECT TOP (2) BranchScope, PublishedJson, PublishedVersion
      FROM dbo.ReceiptStudioTemplate
      WHERE TenantId=@tenantId AND ReceiptType='invoice' AND BranchScope IN (0, @branch) AND PublishedJson IS NOT NULL
      ORDER BY BranchScope DESC
    `);
  for (const row of result.recordset) {
    const template = parseTemplate(row.PublishedJson);
    if (template) return { template, branchScope: row.BranchScope, version: row.PublishedVersion };
  }
  return null;
}
export function pngSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 45 || data.length > 153600) return null;
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  if (data.toString('ascii', 12, 16) !== 'IHDR' || data.readUInt32BE(8) !== 13) return null;
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width < 1 || width > 576 || height < 1 || height > 1200) return null;
  if (data[24] !== 8 || ![2, 6].includes(data[25]) || data[28] !== 0) return null;
  // PNG may contain text metadata but not scripts; only image/png is served with nosniff.
  if (!data.includes(Buffer.from('IEND'))) return null;
  return { width, height };
}
export async function uploadStudioPng(tenantId: string, actor: number, bytes: Buffer) {
  const dimensions = pngSize(bytes);
  if (!dimensions) throw new StudioError('Upload a PNG image up to 150 KB, 576×1200px', 400, 'INVALID_PNG');
  await assertStudioSchema();
  const pool = await getPool();
  const inserted = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('actor', sql.Int, actor)
    .input('data', sql.VarBinary(sql.MAX), bytes)
    .input('width', sql.Int, dimensions.width)
    .input('height', sql.Int, dimensions.height)
    .query(`INSERT dbo.ReceiptStudioAsset (TenantId, Data, WidthPx, HeightPx, CreatedByUserId)
      OUTPUT INSERTED.AssetId AS AssetId
      VALUES (@tenantId, @data, @width, @height, @actor)`);
  return String(inserted.recordset[0].AssetId);
}
export async function assetUrisForTemplate(tenantId: string, template: ReceiptTemplateV1) {
  const ids = [...new Set(template.blocks.filter((b) => b.enabled && b.kind === 'image' && b.assetId).map((b) => b.assetId!))];
  const out: Record<string, string> = {};
  if (!ids.length) return out;
  await assertStudioSchema();
  const pool = await getPool();
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StudioError('Invalid image identifier', 400, 'INVALID_ASSET');
    const found = await pool.request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('id', sql.UniqueIdentifier, id)
      .query(`SELECT Data FROM dbo.ReceiptStudioAsset WHERE TenantId=@tenantId AND AssetId=@id`);
    if (!found.recordset.length) throw new StudioError('Image missing', 400, 'INVALID_ASSET');
    out[id] = 'data:image/png;base64,' + (found.recordset[0].Data as Buffer).toString('base64');
  }
  return out;
}
