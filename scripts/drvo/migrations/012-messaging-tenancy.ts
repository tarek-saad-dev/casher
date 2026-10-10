import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'drvo-migrations',
  '012-messaging-tenancy',
  'schema.sql',
);

export const MESSAGING_TENANCY_MIGRATION_KEY = 'messaging-tenancy';

/** Legacy messaging tables that carry TenantId after migration 12 (when present in the database). */
export const MESSAGING_TENANT_SCOPED_TABLES = [
  'TblMessageInbox',
  'TblMessageOutbox',
  'TblMessageTemplate',
  'TblBotConversation',
  'TblBotMessage',
  'TblBotAiTurn',
  'TblBotBookingPlan',
  'TblBotBookingManagementPlan',
  'TblBotConversationControlEvent',
  'TblBotConversationResumeClaim',
  'TblWhatsAppOutboundCorrelation',
  'TblWhatsAppCampaign',
  'TblWhatsAppCampaignRecipient',
  'TblWhatsAppGroup',
  'TblAiLearningSubmission',
  'TblAiLearningArtifact',
  'TblAiLearningConflict',
  'TblAiLearningAuditEvent',
  'TblSalonKnowledge',
  'TblSalonCapability',
  'TblSalonExternalLink',
  'TblSalonOffer',
  'TblSalonBrandVoice',
  'TblSalonKnowledgeGap',
  'TblSalonBrandVoiceExample',
  'TblSalonKnowledgeSource',
] as const;

/** Global unique objects replaced by tenant-leading unique indexes: [table, legacy, replacement]. */
export const MESSAGING_TENANT_UNIQUE_REPLACEMENTS: ReadonlyArray<readonly [string, string, string]> = [
  ['TblMessageInbox', 'UQ_TblMessageInbox_ProviderMessage', 'UX_TblMessageInbox_TenantProviderMessage'],
  ['TblMessageOutbox', 'UQ_TblMessageOutbox_IdempotencyKey', 'UX_TblMessageOutbox_TenantIdempotencyKey'],
  ['TblBotConversation', 'UQ_TblBotConversation_Identity', 'UX_TblBotConversation_TenantIdentity'],
  ['TblBotMessage', 'UX_TblBotMessage_Provider_ProviderMessageID', 'UX_TblBotMessage_TenantProviderMessage'],
  ['TblMessageTemplate', 'UX_TblMessageTemplate_ActiveGlobal', 'UX_TblMessageTemplate_TenantActiveGlobal'],
  [
    'TblWhatsAppOutboundCorrelation',
    'IX_TblWhatsAppOutboundCorrelation_ProviderMessageID',
    'UX_TblWhatsAppOutboundCorrelation_TenantProviderMessage',
  ],
  ['TblSalonKnowledge', 'UQ_TblSalonKnowledge_ItemKey', 'UX_TblSalonKnowledge_TenantItemKey'],
  ['TblSalonCapability', 'UQ_TblSalonCapability_Key', 'UX_TblSalonCapability_TenantKey'],
  ['TblSalonExternalLink', 'UQ_TblSalonExternalLink_Key', 'UX_TblSalonExternalLink_TenantKey'],
  ['TblSalonOffer', 'UQ_TblSalonOffer_Key', 'UX_TblSalonOffer_TenantKey'],
  ['TblSalonBrandVoice', 'UQ_TblSalonBrandVoice_Key', 'UX_TblSalonBrandVoice_TenantKey'],
  ['TblSalonKnowledgeGap', 'UQ_TblSalonKnowledgeGap_Subject', 'UX_TblSalonKnowledgeGap_TenantSubject'],
  [
    'TblSalonBrandVoiceExample',
    'UQ_TblSalonBrandVoiceExample_ScenarioKey',
    'UX_TblSalonBrandVoiceExample_TenantScenarioKey',
  ],
  ['TblSalonKnowledgeSource', 'UQ_TblSalonKnowledgeSource_Name', 'UX_TblSalonKnowledgeSource_TenantName'],
];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  TenantMessagingChannel: [
    'ChannelId',
    'TenantId',
    'Channel',
    'Provider',
    'EndpointUrl',
    'SessionId',
    'PhoneNumber',
    'WebhookTokenHash',
    'Status',
  ],
  TenantAiConfig: [
    'TenantId',
    'Enabled',
    'IndustryCode',
    'BusinessName',
    'AssistantPersona',
    'Locale',
    'WebsiteUrl',
    'BookingUrl',
    'PricesUrl',
    'BusinessHoursJson',
    'PoliciesJson',
    'BookingActorUserId',
    'ConversationPack',
    'Revision',
  ],
  TenantMessagingUsage: ['TenantId', 'UsageDate', 'Channel', 'Metric', 'Count'],
};

const REQUIRED_OBJECTS = [
  'PK_TenantMessagingChannel',
  'FK_TenantMessagingChannel_Tenant',
  'CK_TenantMessagingChannel_Status',
  'CK_TenantMessagingChannel_Active',
  'CK_TenantMessagingChannel_TokenHash',
  'PK_TenantAiConfig',
  'FK_TenantAiConfig_Tenant',
  'PK_TenantMessagingUsage',
  'FK_TenantMessagingUsage_Tenant',
];

async function tableExists(pool: ConnectionPool, table: string): Promise<boolean> {
  const r = await pool
    .request()
    .input('name', `dbo.${table}`)
    .query(`SELECT CASE WHEN OBJECT_ID(@name, N'U') IS NULL THEN 0 ELSE 1 END AS ok;`);
  return Number(r.recordset[0]?.ok) === 1;
}

/** Read-only verification of migration 12. Never mutates. */
export async function verifyMessagingTenancySchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];

  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!(await tableExists(pool, table))) {
      failures.push(`Missing table dbo.${table}`);
      continue;
    }
    for (const column of columns) {
      const c = await pool
        .request()
        .input('name', `dbo.${table}`)
        .input('column', column)
        .query(`SELECT CASE WHEN COL_LENGTH(@name, @column) IS NULL THEN 0 ELSE 1 END AS ok;`);
      if (Number(c.recordset[0]?.ok) !== 1) failures.push(`Missing column dbo.${table}.${column}`);
    }
  }
  for (const name of REQUIRED_OBJECTS) {
    const r = await pool
      .request()
      .input('name', name)
      .query(`SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.objects WHERE name = @name) THEN 1 ELSE 0 END AS ok;`);
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing constraint ${name}`);
  }
  if (failures.length) return { ok: false, failures };

  for (const table of MESSAGING_TENANT_SCOPED_TABLES) {
    if (!(await tableExists(pool, table))) continue;
    const col = await pool
      .request()
      .input('name', `dbo.${table}`)
      .query(`SELECT CASE WHEN COL_LENGTH(@name, N'TenantId') IS NULL THEN 0 ELSE 1 END AS ok;`);
    if (Number(col.recordset[0]?.ok) !== 1) {
      failures.push(`Missing column dbo.${table}.TenantId`);
      continue;
    }
    const fk = await pool
      .request()
      .input('fk', `FK_${table}_Tenant`)
      .query(`SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = @fk) THEN 1 ELSE 0 END AS ok;`);
    if (Number(fk.recordset[0]?.ok) !== 1) failures.push(`Missing FK_${table}_Tenant`);
    const nulls = await pool
      .request()
      .query(`SELECT COUNT_BIG(*) AS n FROM dbo.[${table}] WITH (NOLOCK) WHERE TenantId IS NULL;`);
    const n = Number(nulls.recordset[0]?.n ?? 0);
    if (n > 0) failures.push(`dbo.${table} has ${n} row(s) without TenantId (repair: re-run migration 12 apply)`);
  }

  for (const [table, legacy, replacement] of MESSAGING_TENANT_UNIQUE_REPLACEMENTS) {
    if (!(await tableExists(pool, table))) continue;
    const r = await pool
      .request()
      .input('table', `dbo.${table}`)
      .input('legacy', legacy)
      .input('replacement', replacement)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID(@table) AND name = @replacement AND is_unique = 1) AS hasNew,
          (SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID(@table) AND name = @legacy) AS hasLegacy;
      `);
    const row = r.recordset[0] as { hasNew: number; hasLegacy: number };
    if (Number(row.hasNew) !== 1) failures.push(`Missing tenant-leading unique ${replacement} on dbo.${table}`);
    if (Number(row.hasLegacy) !== 0) failures.push(`Global unique ${legacy} still present on dbo.${table}`);
  }

  const boot = await pool.request().query(`
    SELECT TOP 1 t.TenantId,
      (SELECT COUNT(*) FROM dbo.TenantAiConfig c WHERE c.TenantId = t.TenantId) AS aiConfig,
      (SELECT COUNT(*) FROM dbo.TenantMessagingChannel ch WHERE ch.TenantId = t.TenantId AND ch.Channel = N'whatsapp') AS channels
    FROM dbo.Tenant t WITH (NOLOCK)
    WHERE t.Code = N'CASHER_BOOT';
  `);
  const bootRow = boot.recordset[0] as { aiConfig: number; channels: number } | undefined;
  if (bootRow) {
    if (Number(bootRow.aiConfig) !== 1) failures.push('CASHER_BOOT has no TenantAiConfig row');
    if (Number(bootRow.channels) < 1) failures.push('CASHER_BOOT has no TenantMessagingChannel row');
  }

  return { ok: failures.length === 0, failures };
}

export const messagingTenancyMigration: DrvoMigrationDefinition = {
  migrationId: 12,
  migrationKey: MESSAGING_TENANCY_MIGRATION_KEY,
  name: 'DRVO-018 Messaging, WhatsApp and AI receptionist multi-tenancy',
  dependencies: ['platform-core', 'platform-bootstrap'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'mixed',
    risk: 'HIGH',
    requiresBackup: true,
    lockProfile: 'potentially-blocking',
    rollbackStrategy:
      'Expand-only for data: TenantId columns stay NULLable, so reverting the application commit keeps legacy inserts working (legacy code ignores TenantId), then forward-fix and re-run apply to backfill rows written during the rollback. Global unique constraints on provider message ids, idempotency keys, conversation identity and knowledge keys are replaced by tenant-leading unique indexes; during an app rollback uniqueness still holds per tenant (NULL TenantId rows are unique among themselves). Recreating the global constraints or dropping DRVO-018 tables/columns is not a normal rollback and needs explicit approval. Restore the approved backup only when explicitly required.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyMessagingTenancySchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    const report = await verifyMessagingTenancySchema(ctx.pool);
    return report.ok;
  },
};
