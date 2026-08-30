/**
 * Production SQL hub for TblSalon* tables.
 * Empty snapshot if tables missing — NEVER falls back to fixtures.
 */
import { getPool, sql } from '@/lib/db';
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
  try {
    const pool = await getPool();
    const knWhere = includeInactive ? '' : ` WHERE Status = N'active'`;
    const capWhere = includeInactive ? '' : ` WHERE Status = N'active'`;
    const linkWhere = includeInactive ? '' : ` WHERE Status = N'active'`;
    const offerWhere = includeInactive ? '' : ` WHERE Status = N'active'`;
    const exWhere = includeInactive ? '' : ` WHERE IsActive = 1`;
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
      pool.request().query(`SELECT * FROM dbo.TblSalonKnowledge${knWhere}`),
      pool.request().query(`SELECT * FROM dbo.TblSalonCapability${capWhere}`),
      pool.request().query(`SELECT * FROM dbo.TblSalonExternalLink${linkWhere}`),
      pool.request().query(`SELECT * FROM dbo.TblSalonOffer${offerWhere}`),
      pool.request().query(`SELECT TOP 1 * FROM dbo.TblSalonBrandVoice WHERE Status = N'active' ORDER BY VoiceID DESC`),
      pool.request().query(`SELECT * FROM dbo.TblSalonBrandVoiceExample${exWhere}`),
      pool.request().query(`SELECT * FROM dbo.TblSalonKnowledgeSource`),
      pool.request().query(`SELECT * FROM dbo.TblSalonKnowledgeGap`),
    ]);
    return {
      knowledge: knowledge.recordset.map((r) => mapKnowledge(r as Record<string, unknown>)),
      capabilities: capabilities.recordset.map((r) => mapCapability(r as Record<string, unknown>)),
      links: links.recordset.map((r) => mapLink(r as Record<string, unknown>)),
      offers: offers.recordset.map((r) => mapOffer(r as Record<string, unknown>)),
      brandVoice: mapVoice(voice.recordset[0] as Record<string, unknown> | undefined),
      examples: examples.recordset.map((r) => mapExample(r as Record<string, unknown>)),
      sources: sources.recordset.map((r) => mapSource(r as Record<string, unknown>)),
      gaps: gaps.recordset.map((r) => mapGap(r as Record<string, unknown>)),
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
  return getCachedSnapshot(() => loadSnapshotUncached(false));
}

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
  try {
    const pool = await getPool();
    await pool
      .request()
      .input('subj', sql.NVarChar(300), gap.normalizedSubject)
      .input('cat', sql.NVarChar(60), gap.categoryGuess ?? null)
      .query(`
        MERGE dbo.TblSalonKnowledgeGap AS t
        USING (SELECT @subj AS NormalizedSubject) AS s
        ON t.NormalizedSubject = s.NormalizedSubject
        WHEN MATCHED THEN
          UPDATE SET HitCount = t.HitCount + 1, LastSeenAt = SYSUTCDATETIME(),
            CategoryGuess = COALESCE(t.CategoryGuess, @cat), UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (NormalizedSubject, CategoryGuess, HitCount, FirstSeenAt, LastSeenAt, Status)
          VALUES (@subj, @cat, 1, SYSUTCDATETIME(), SYSUTCDATETIME(), N'open');
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
  await pool
    .request()
    .input('subj', sql.NVarChar(300), normalizedSubject)
    .input('st', sql.NVarChar(20), status)
    .query(`
      UPDATE dbo.TblSalonKnowledgeGap
      SET Status = @st, UpdatedAt = SYSUTCDATETIME()
      WHERE NormalizedSubject = @subj
    `);
  invalidateConciergeCache();
}

export { invalidateConciergeCache };
