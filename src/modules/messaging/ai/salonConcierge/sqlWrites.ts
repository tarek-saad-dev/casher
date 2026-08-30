/**
 * Production SQL writes for admin. Invalidates concierge cache.
 * Never used as a Gemini SQL surface.
 */
import { getPool, sql } from '@/lib/db';
import { invalidateConciergeCache } from './cache';
import { normalizeConciergeText } from './matching';
import type {
  BrandVoiceProfile,
  CapabilityItem,
  ExternalLinkItem,
  KnowledgeItem,
  KnowledgeSourceRecord,
  OfferItem,
  VoiceExample,
} from './types';

function jsonArr(v: unknown): string {
  const arr = Array.isArray(v) ? v : [];
  return JSON.stringify(arr);
}

export async function sqlUpsertKnowledge(item: Partial<KnowledgeItem> & { key: string; title: string; answerText: string; category: string }): Promise<void> {
  const pool = await getPool();
  const norm = normalizeConciergeText(item.subject || item.title).slice(0, 400);
  await pool
    .request()
    .input('key', sql.NVarChar(120), item.key)
    .input('cat', sql.NVarChar(60), item.category)
    .input('branchId', sql.Int, item.branchId ?? null)
    .input('branchCode', sql.NVarChar(50), item.branchCode ?? null)
    .input('empId', sql.Int, item.employeeId ?? null)
    .input('lang', sql.NVarChar(10), item.language ?? 'ar')
    .input('title', sql.NVarChar(300), item.title)
    .input('subject', sql.NVarChar(500), item.subject ?? null)
    .input('norm', sql.NVarChar(400), norm)
    .input('answer', sql.NVarChar(sql.MAX), item.answerText)
    .input('aliases', sql.NVarChar(sql.MAX), jsonArr(item.aliases))
    .input('tags', sql.NVarChar(sql.MAX), jsonArr(item.tags))
    .input('source', sql.NVarChar(40), item.source ?? 'curated')
    .input('status', sql.NVarChar(20), item.status ?? 'active')
    .input('priority', sql.Int, item.priority ?? 100)
    .input('vf', sql.DateTime2, item.validFrom ? new Date(item.validFrom) : null)
    .input('vt', sql.DateTime2, item.validTo ? new Date(item.validTo) : null)
    .query(`
      MERGE dbo.TblSalonKnowledge AS t
      USING (SELECT @key AS ItemKey) AS s
      ON t.ItemKey = s.ItemKey
      WHEN MATCHED THEN UPDATE SET
        Category=@cat, BranchID=@branchId, BranchCode=@branchCode, EmployeeID=@empId,
        Language=@lang, Title=@title, Subject=@subject, NormalizedSubject=@norm,
        AnswerText=@answer, AliasesJson=@aliases, TagsJson=@tags, Source=@source,
        Status=@status, Priority=@priority, ValidFrom=@vf, ValidTo=@vt, UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (
        ItemKey, Category, BranchID, BranchCode, EmployeeID, Language, Title, Subject,
        NormalizedSubject, AnswerText, AliasesJson, TagsJson, Source, Status, Priority, ValidFrom, ValidTo
      ) VALUES (
        @key, @cat, @branchId, @branchCode, @empId, @lang, @title, @subject,
        @norm, @answer, @aliases, @tags, @source, @status, @priority, @vf, @vt
      );
    `);
  invalidateConciergeCache();
}

export async function sqlPatchKnowledgeStatus(key: string, status: string): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('key', sql.NVarChar(120), key)
    .input('st', sql.NVarChar(20), status)
    .query(`UPDATE dbo.TblSalonKnowledge SET Status=@st, UpdatedAt=SYSUTCDATETIME() WHERE ItemKey=@key`);
  invalidateConciergeCache();
  return (r.rowsAffected[0] ?? 0) > 0;
}

export async function sqlUpsertCapability(item: Partial<CapabilityItem> & { key: string; displayNameAr: string }): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('key', sql.NVarChar(120), item.key)
    .input('name', sql.NVarChar(200), item.displayNameAr)
    .input('aliases', sql.NVarChar(sql.MAX), jsonArr(item.aliases))
    .input('desc', sql.NVarChar(sql.MAX), item.descriptionAr ?? null)
    .input('svc', sql.NVarChar(500), jsonArr(item.serviceIds))
    .input('emp', sql.NVarChar(500), jsonArr(item.employeeIds))
    .input('empNames', sql.NVarChar(500), jsonArr(item.employeeNames))
    .input('branches', sql.NVarChar(500), jsonArr(item.branchCodes))
    .input('status', sql.NVarChar(20), item.status ?? 'active')
    .query(`
      MERGE dbo.TblSalonCapability AS t
      USING (SELECT @key AS CapabilityKey) AS s
      ON t.CapabilityKey = s.CapabilityKey
      WHEN MATCHED THEN UPDATE SET
        DisplayNameAr=@name, AliasesJson=@aliases, DescriptionAr=@desc,
        ServiceIdsJson=@svc, EmployeeIdsJson=@emp, EmployeeNamesJson=@empNames,
        BranchCodesJson=@branches, Status=@status, UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (
        CapabilityKey, DisplayNameAr, AliasesJson, DescriptionAr, ServiceIdsJson,
        EmployeeIdsJson, EmployeeNamesJson, BranchCodesJson, Status
      ) VALUES (
        @key, @name, @aliases, @desc, @svc, @emp, @empNames, @branches, @status
      );
    `);
  invalidateConciergeCache();
}

export async function sqlUpsertLink(item: Partial<ExternalLinkItem> & { key: string; linkType: string; labelAr: string; url: string }): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('key', sql.NVarChar(120), item.key)
    .input('type', sql.NVarChar(40), item.linkType)
    .input('branch', sql.NVarChar(50), item.branchCode ?? null)
    .input('label', sql.NVarChar(200), item.labelAr)
    .input('url', sql.NVarChar(1000), item.url)
    .input('status', sql.NVarChar(20), item.status ?? 'active')
    .query(`
      MERGE dbo.TblSalonExternalLink AS t
      USING (SELECT @key AS LinkKey) AS s
      ON t.LinkKey = s.LinkKey
      WHEN MATCHED THEN UPDATE SET
        LinkType=@type, BranchCode=@branch, LabelAr=@label, Url=@url, Status=@status, UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (LinkKey, LinkType, BranchCode, LabelAr, Url, Status)
      VALUES (@key, @type, @branch, @label, @url, @status);
    `);
  invalidateConciergeCache();
}

export async function sqlUpsertOffer(item: Partial<OfferItem> & { key: string; titleAr: string; descriptionAr: string }): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('key', sql.NVarChar(120), item.key)
    .input('title', sql.NVarChar(300), item.titleAr)
    .input('desc', sql.NVarChar(sql.MAX), item.descriptionAr)
    .input('branches', sql.NVarChar(500), jsonArr(item.branchCodes))
    .input('svc', sql.NVarChar(500), jsonArr(item.serviceIds))
    .input('vf', sql.DateTime2, item.validFrom ? new Date(item.validFrom) : null)
    .input('vt', sql.DateTime2, item.validTo ? new Date(item.validTo) : null)
    .input('status', sql.NVarChar(20), item.status ?? 'active')
    .input('priority', sql.Int, item.priority ?? 100)
    .query(`
      MERGE dbo.TblSalonOffer AS t
      USING (SELECT @key AS OfferKey) AS s
      ON t.OfferKey = s.OfferKey
      WHEN MATCHED THEN UPDATE SET
        TitleAr=@title, DescriptionAr=@desc, BranchCodesJson=@branches, ServiceIdsJson=@svc,
        ValidFrom=@vf, ValidTo=@vt, Status=@status, Priority=@priority, UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (
        OfferKey, TitleAr, DescriptionAr, BranchCodesJson, ServiceIdsJson, ValidFrom, ValidTo, Status, Priority
      ) VALUES (
        @key, @title, @desc, @branches, @svc, @vf, @vt, @status, @priority
      );
    `);
  invalidateConciergeCache();
}

export async function sqlUpsertBrandVoice(profileKey: string, config: BrandVoiceProfile): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('key', sql.NVarChar(80), profileKey)
    .input('json', sql.NVarChar(sql.MAX), JSON.stringify(config))
    .query(`
      MERGE dbo.TblSalonBrandVoice AS t
      USING (SELECT @key AS ProfileKey) AS s
      ON t.ProfileKey = s.ProfileKey
      WHEN MATCHED THEN UPDATE SET ConfigJson=@json, Status=N'active', UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (ProfileKey, ConfigJson, Status)
      VALUES (@key, @json, N'active');
    `);
  invalidateConciergeCache();
}

export async function sqlUpsertVoiceExample(ex: Partial<VoiceExample> & { scenarioKey: string; category: string; customerMessage: string; preferredResponse: string }): Promise<void> {
  const pool = await getPool();
  if (ex.id) {
    await pool
      .request()
      .input('id', sql.BigInt, ex.id)
      .input('sk', sql.NVarChar(120), ex.scenarioKey)
      .input('cat', sql.NVarChar(60), ex.category)
      .input('cm', sql.NVarChar(500), ex.customerMessage)
      .input('pr', sql.NVarChar(sql.MAX), ex.preferredResponse)
      .input('notes', sql.NVarChar(500), ex.notes ?? null)
      .input('pri', sql.Int, ex.priority ?? 100)
      .input('act', sql.Bit, ex.isActive === false ? 0 : 1)
      .query(`
        UPDATE dbo.TblSalonBrandVoiceExample
        SET ScenarioKey=@sk, Category=@cat, CustomerMessage=@cm, PreferredResponse=@pr,
            Notes=@notes, Priority=@pri, IsActive=@act, UpdatedAt=SYSUTCDATETIME()
        WHERE ExampleID=@id
      `);
  } else {
    await pool
      .request()
      .input('sk', sql.NVarChar(120), ex.scenarioKey)
      .input('cat', sql.NVarChar(60), ex.category)
      .input('cm', sql.NVarChar(500), ex.customerMessage)
      .input('pr', sql.NVarChar(sql.MAX), ex.preferredResponse)
      .input('notes', sql.NVarChar(500), ex.notes ?? null)
      .input('pri', sql.Int, ex.priority ?? 100)
      .input('act', sql.Bit, ex.isActive === false ? 0 : 1)
      .query(`
        MERGE dbo.TblSalonBrandVoiceExample AS t
        USING (SELECT @sk AS ScenarioKey) AS s
        ON t.ScenarioKey = s.ScenarioKey
        WHEN MATCHED THEN UPDATE SET
          Category=@cat, CustomerMessage=@cm, PreferredResponse=@pr,
          Notes=@notes, Priority=@pri, IsActive=@act, UpdatedAt=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT
          (ScenarioKey, Category, CustomerMessage, PreferredResponse, Notes, Priority, IsActive)
        VALUES (@sk, @cat, @cm, @pr, @notes, @pri, @act);
      `);
  }
  invalidateConciergeCache();
}

export async function sqlUpsertSource(src: Partial<KnowledgeSourceRecord> & { name: string; sourceType: string }): Promise<void> {
  const pool = await getPool();
  if (src.id) {
    await pool
      .request()
      .input('id', sql.BigInt, src.id)
      .input('name', sql.NVarChar(200), src.name)
      .input('type', sql.NVarChar(40), src.sourceType)
      .input('url', sql.NVarChar(1000), src.urlOrRef ?? null)
      .input('branch', sql.NVarChar(50), src.branchCode ?? null)
      .input('act', sql.Bit, src.active === false ? 0 : 1)
      .input('notes', sql.NVarChar(500), src.notes ?? null)
      .query(`
        UPDATE dbo.TblSalonKnowledgeSource
        SET SourceName=@name, SourceType=@type, UrlOrRef=@url, BranchCode=@branch,
            Active=@act, Notes=@notes, UpdatedAt=SYSUTCDATETIME()
        WHERE SourceID=@id
      `);
  } else {
    await pool
      .request()
      .input('name', sql.NVarChar(200), src.name)
      .input('type', sql.NVarChar(40), src.sourceType)
      .input('url', sql.NVarChar(1000), src.urlOrRef ?? null)
      .input('branch', sql.NVarChar(50), src.branchCode ?? null)
      .input('act', sql.Bit, src.active === false ? 0 : 1)
      .input('notes', sql.NVarChar(500), src.notes ?? null)
      .query(`
        INSERT INTO dbo.TblSalonKnowledgeSource (SourceName, SourceType, UrlOrRef, BranchCode, Active, Notes)
        VALUES (@name, @type, @url, @branch, @act, @notes)
      `);
  }
  invalidateConciergeCache();
}

export async function sqlSetGapStatus(normalizedSubject: string, status: string): Promise<void> {
  const { setGapStatusSql } = await import('./sqlRepository');
  await setGapStatusSql(normalizedSubject, status as 'open' | 'ignored' | 'resolved');
}

export async function sqlDeleteKnowledge(key: string): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('key', sql.NVarChar(120), key)
    .query(`DELETE FROM dbo.TblSalonKnowledge WHERE ItemKey=@key`);
  invalidateConciergeCache();
  return (r.rowsAffected[0] ?? 0) > 0;
}
