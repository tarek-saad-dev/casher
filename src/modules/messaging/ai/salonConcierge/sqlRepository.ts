/**
 * Production SQL hub for TblSalon* tables.
 * Empty snapshot if tables missing — NEVER falls back to fixtures.
 */
import { getPool, sql } from '@/lib/db';
import { requireMessagingTenantId } from '@/modules/messaging/tenancy/messagingTenantScope';
import { bindMessagingTenant } from '@/modules/messaging/tenancy/tenantSql';
import { getCachedSnapshot, invalidateConciergeCache } from './cache';
import { DEFAULT_BRAND_VOICE, emptyConciergeSnapshot } from './defaults';
import { isoOrNull, parseNumberArray, parseStringArray } from './sqlMappers';
import type {
  BrandVoiceProfile,
  CapabilityItem,
  ConciergeSnapshot,
  ExternalLinkItem,
  KnowledgeGap,
  KnowledgeItem,
  KnowledgeSourceRecord,
  OfferItem,
  VoiceExample,
} from './types';

function mapKnowledge(row: Record<string, unknown>): KnowledgeItem {
  return {
    id: Number(row.KnowledgeID),
    key: String(row.ItemKey),
    category: String(row.Category),
    branchId: row.BranchID != null ? Number(row.BranchID) : null,
    branchCode: row.BranchCode != null ? String(row.BranchCode) : null,
    employeeId: row.EmployeeID != null ? Number(row.EmployeeID) : null,
    language: String(row.Language ?? 'ar'),
    title: String(row.Title),
    subject: row.Subject != null ? String(row.Subject) : null,
    answerText: String(row.AnswerText),
    aliases: parseStringArray(row.AliasesJson),
    tags: parseStringArray(row.TagsJson),
    source: (String(row.Source || 'curated') as KnowledgeItem['source']),
    status: String(row.Status) as KnowledgeItem['status'],
    priority: Number(row.Priority ?? 100),
    validFrom: isoOrNull(row.ValidFrom),
    validTo: isoOrNull(row.ValidTo),
    updatedAt: isoOrNull(row.UpdatedAt),
  };
}

function mapCapability(row: Record<string, unknown>): CapabilityItem {
  return {
    id: Number(row.CapabilityID),
    key: String(row.CapabilityKey),
    displayNameAr: String(row.DisplayNameAr),
    aliases: parseStringArray(row.AliasesJson),
    descriptionAr: row.DescriptionAr != null ? String(row.DescriptionAr) : null,
    serviceIds: parseNumberArray(row.ServiceIdsJson),
    employeeIds: parseNumberArray(row.EmployeeIdsJson),
    employeeNames: parseStringArray(row.EmployeeNamesJson),
    branchCodes: parseStringArray(row.BranchCodesJson),
    status: String(row.Status) as CapabilityItem['status'],
  };
}

function mapLink(row: Record<string, unknown>): ExternalLinkItem {
  return {
    id: Number(row.LinkID),
    key: String(row.LinkKey),
    linkType: String(row.LinkType) as ExternalLinkItem['linkType'],
    branchCode: row.BranchCode != null ? String(row.BranchCode) : null,
    labelAr: String(row.LabelAr),
    url: String(row.Url),
    status: String(row.Status) as ExternalLinkItem['status'],
  };
}

function mapOffer(row: Record<string, unknown>): OfferItem {
  return {
    id: Number(row.OfferID),
    key: String(row.OfferKey),
    titleAr: String(row.TitleAr),
    descriptionAr: String(row.DescriptionAr),
    branchCodes: parseStringArray(row.BranchCodesJson),
    serviceIds: parseNumberArray(row.ServiceIdsJson),
    validFrom: isoOrNull(row.ValidFrom),
    validTo: isoOrNull(row.ValidTo),
    status: String(row.Status) as OfferItem['status'],
    priority: Number(row.Priority ?? 100),
  };
}

function mapVoice(row: Record<string, unknown> | undefined): BrandVoiceProfile {
  if (!row?.ConfigJson) return { ...DEFAULT_BRAND_VOICE };
  try {
    const parsed = JSON.parse(String(row.ConfigJson)) as Partial<BrandVoiceProfile>;
    return {
      ...DEFAULT_BRAND_VOICE,
      ...parsed,
      bannedAddressTerms: parsed.bannedAddressTerms ?? DEFAULT_BRAND_VOICE.bannedAddressTerms,
      preferredAddressTerms: parsed.preferredAddressTerms ?? DEFAULT_BRAND_VOICE.preferredAddressTerms,
      bannedPhrases: parsed.bannedPhrases ?? DEFAULT_BRAND_VOICE.bannedPhrases,
    };
  } catch {
    return { ...DEFAULT_BRAND_VOICE };
  }
}

function mapExample(row: Record<string, unknown>): VoiceExample {
  return {
    id: Number(row.ExampleID),
    scenarioKey: String(row.ScenarioKey),
    category: String(row.Category),
    customerMessage: String(row.CustomerMessage),
    preferredResponse: String(row.PreferredResponse),
    notes: row.Notes != null ? String(row.Notes) : null,
    priority: Number(row.Priority ?? 100),
    isActive: Boolean(row.IsActive),
  };
}

function mapSource(row: Record<string, unknown>): KnowledgeSourceRecord {
  return {
    id: Number(row.SourceID),
    name: String(row.SourceName),
    sourceType: String(row.SourceType),
    urlOrRef: row.UrlOrRef != null ? String(row.UrlOrRef) : null,
    branchCode: row.BranchCode != null ? String(row.BranchCode) : null,
    active: Boolean(row.Active),
    lastReviewedAt: isoOrNull(row.LastReviewedAt),
    notes: row.Notes != null ? String(row.Notes) : null,
  };
}

function mapGap(row: Record<string, unknown>): KnowledgeGap {
  return {
    id: Number(row.GapID),
    normalizedSubject: String(row.NormalizedSubject),
    categoryGuess: row.CategoryGuess != null ? String(row.CategoryGuess) : null,
    hitCount: Number(row.HitCount ?? 1),
    firstSeenAt: isoOrNull(row.FirstSeenAt) ?? new Date().toISOString(),
    lastSeenAt: isoOrNull(row.LastSeenAt) ?? new Date().toISOString(),
    status: (String(row.Status || 'open') as KnowledgeGap['status']),
  };
}

async function loadSnapshotUncached(includeInactive: boolean): Promise<ConciergeSnapshot> {
  // Resolved outside the try so a missing tenant scope fails closed instead of yielding an empty snapshot.
  requireMessagingTenantId('salonConcierge.loadSnapshot');
  try {
    const pool = await getPool();
    const tenantWhere = ` WHERE TenantId = @tenantId`;
    const knWhere = includeInactive ? tenantWhere : `${tenantWhere} AND Status = N'active'`;
    const capWhere = includeInactive ? tenantWhere : `${tenantWhere} AND Status = N'active'`;
    const linkWhere = includeInactive ? tenantWhere : `${tenantWhere} AND Status = N'active'`;
    const offerWhere = includeInactive ? tenantWhere : `${tenantWhere} AND Status = N'active'`;
    const exWhere = includeInactive ? tenantWhere : `${tenantWhere} AND IsActive = 1`;
    const req = (fn: string) => bindMessagingTenant(pool.request(), `salonConcierge.loadSnapshot.${fn}`);
    const [
      knowledge,
      capabilities,
      links,
      offers,
      voice,
      examples,
      sources,
      gaps,
    ] = await Promise.all([
      req('knowledge').query(`SELECT * FROM dbo.TblSalonKnowledge${knWhere}`),
      req('capabilities').query(`SELECT * FROM dbo.TblSalonCapability${capWhere}`),
      req('links').query(`SELECT * FROM dbo.TblSalonExternalLink${linkWhere}`),
      req('offers').query(`SELECT * FROM dbo.TblSalonOffer${offerWhere}`),
      req('voice').query(
        `SELECT TOP 1 * FROM dbo.TblSalonBrandVoice${tenantWhere} AND Status = N'active' ORDER BY VoiceID DESC`,
      ),
      req('examples').query(`SELECT * FROM dbo.TblSalonBrandVoiceExample${exWhere}`),
      req('sources').query(`SELECT * FROM dbo.TblSalonKnowledgeSource${tenantWhere}`),
      req('gaps').query(`SELECT * FROM dbo.TblSalonKnowledgeGap${tenantWhere}`),
    ]);
    return {
      knowledge: knowledge.recordset.map((r: Record<string, unknown>) => mapKnowledge(r as Record<string, unknown>)),
      capabilities: capabilities.recordset.map((r: Record<string, unknown>) => mapCapability(r as Record<string, unknown>)),
      links: links.recordset.map((r: Record<string, unknown>) => mapLink(r as Record<string, unknown>)),
      offers: offers.recordset.map((r: Record<string, unknown>) => mapOffer(r as Record<string, unknown>)),
      brandVoice: mapVoice(voice.recordset[0] as Record<string, unknown> | undefined),
      examples: examples.recordset.map((r: Record<string, unknown>) => mapExample(r as Record<string, unknown>)),
      sources: sources.recordset.map((r: Record<string, unknown>) => mapSource(r as Record<string, unknown>)),
      gaps: gaps.recordset.map((r: Record<string, unknown>) => mapGap(r as Record<string, unknown>)),
    };
  } catch {
    return emptyConciergeSnapshot();
  }
}

export async function loadProductionSnapshot(opts?: {
  includeInactive?: boolean;
  skipCache?: boolean;
}): Promise<ConciergeSnapshot> {
  const includeInactive = Boolean(opts?.includeInactive);
  if (opts?.skipCache || includeInactive) {
    return loadSnapshotUncached(includeInactive);
  }
  const tenantId = requireMessagingTenantId('salonConcierge.loadProductionSnapshot');
  // The shared cache entry holds a per-tenant map so invalidateConciergeCache() still clears every tenant.
  const byTenant = await getCachedSnapshot<TenantSnapshotMap>(async () => new Map());
  let snapshot = byTenant.get(tenantId);
  if (!snapshot) {
    snapshot = loadSnapshotUncached(false);
    byTenant.set(tenantId, snapshot);
  }
  return snapshot;
}

type TenantSnapshotMap = Map<string, Promise<ConciergeSnapshot>>;

export async function probeConciergeTables(): Promise<{
  ready: boolean;
  tables: Record<string, boolean>;
}> {
  const names = [
    'TblSalonKnowledge',
    'TblSalonCapability',
    'TblSalonExternalLink',
    'TblSalonOffer',
    'TblSalonBrandVoice',
    'TblSalonKnowledgeGap',
    'TblSalonBrandVoiceExample',
    'TblSalonKnowledgeSource',
  ];
  const tables: Record<string, boolean> = {};
  try {
    const pool = await getPool();
    for (const name of names) {
      const r = await pool
        .request()
        .input('n', sql.NVarChar(128), name)
        .query(`SELECT CASE WHEN OBJECT_ID(N'dbo.' + @n, N'U') IS NULL THEN 0 ELSE 1 END AS Present`);
      tables[name] = Number(r.recordset[0]?.Present) === 1;
    }
  } catch {
    for (const name of names) tables[name] = false;
  }
  return { ready: Object.values(tables).every(Boolean), tables };
}

export async function upsertKnowledgeGapSql(gap: {
  normalizedSubject: string;
  categoryGuess?: string | null;
}): Promise<void> {
  // Outside the try: a missing tenant scope must not be swallowed as "tables may not exist".
  requireMessagingTenantId('salonConcierge.upsertKnowledgeGap');
  try {
    const pool = await getPool();
    await bindMessagingTenant(pool.request(), 'salonConcierge.upsertKnowledgeGap')
      .input('subj', sql.NVarChar(300), gap.normalizedSubject)
      .input('cat', sql.NVarChar(60), gap.categoryGuess ?? null)
      .query(`
        MERGE dbo.TblSalonKnowledgeGap AS t
        USING (SELECT @subj AS NormalizedSubject) AS s
        ON t.TenantId = @tenantId AND t.NormalizedSubject = s.NormalizedSubject
        WHEN MATCHED THEN
          UPDATE SET HitCount = t.HitCount + 1, LastSeenAt = SYSUTCDATETIME(),
            CategoryGuess = COALESCE(t.CategoryGuess, @cat), UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (TenantId, NormalizedSubject, CategoryGuess, HitCount, FirstSeenAt, LastSeenAt, Status)
          VALUES (@tenantId, @subj, @cat, 1, SYSUTCDATETIME(), SYSUTCDATETIME(), N'open');
      `);
    invalidateConciergeCache();
  } catch {
    /* tables may not exist yet */
  }
}

export async function setGapStatusSql(
  normalizedSubject: string,
  status: KnowledgeGap['status'],
): Promise<void> {
  const pool = await getPool();
  await bindMessagingTenant(pool.request(), 'salonConcierge.setGapStatus')
    .input('subj', sql.NVarChar(300), normalizedSubject)
    .input('st', sql.NVarChar(20), status)
    .query(`
      UPDATE dbo.TblSalonKnowledgeGap
      SET Status = @st, UpdatedAt = SYSUTCDATETIME()
      WHERE NormalizedSubject = @subj AND TenantId = @tenantId
    `);
  invalidateConciergeCache();
}

export { invalidateConciergeCache };
