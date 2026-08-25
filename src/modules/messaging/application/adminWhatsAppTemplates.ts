import {
  getCodeDefaultTemplate,
  resolveTemplateContent,
} from './composeMessage';
import {
  getWhatsAppTemplateDefinition,
  listWhatsAppTemplateDefinitions,
  sampleVariablesForDefinition,
  type WhatsAppTemplateDefinition,
} from '../templates/definitions';
import { validateTemplatePlaceholders } from '../templates/validatePlaceholders';
import { renderTemplate } from '../templates/renderTemplate';
import {
  deactivateBranchMessageTemplateOverride,
  listMessageTemplateRows,
  upsertBranchMessageTemplateOverride,
  type MessageTemplateLookupResult,
  type MessageTemplateStoredRow,
} from '../templates/repository/messageTemplateRepository';
import {
  MessageTemplateAdminError,
  type MessageTemplateSource,
} from '../domain/templateTypes';

export type AdminTemplateOverrideView = {
  id: number;
  content: string;
  version: number;
  isActive: boolean;
  updatedAt?: string;
};

export type AdminWhatsAppTemplateView = {
  templateKey: string;
  channel: 'whatsapp';
  language: 'ar';
  label: string;
  description: string;
  availableVariables: WhatsAppTemplateDefinition['availableVariables'];
  effectiveContent: string;
  effectiveSource: MessageTemplateSource;
  branchOverride: AdminTemplateOverrideView | null;
  globalTemplate: AdminTemplateOverrideView | null;
};

function toOverrideView(row: MessageTemplateStoredRow | null): AdminTemplateOverrideView | null {
  if (!row) return null;
  return {
    id: row.id,
    content: row.content,
    version: row.version,
    isActive: row.isActive,
    ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
  };
}

function pickPreferredRow(rows: MessageTemplateStoredRow[]): MessageTemplateStoredRow | null {
  if (rows.length === 0) return null;
  const active = rows.filter((row) => row.isActive);
  const pool = active.length > 0 ? active : rows;
  return [...pool].sort((a, b) => b.version - a.version || b.id - a.id)[0] ?? null;
}

function activeLookupHit(
  branchOverride: MessageTemplateStoredRow | null,
  globalTemplate: MessageTemplateStoredRow | null,
): MessageTemplateLookupResult | null {
  if (branchOverride?.isActive && branchOverride.content.trim().length > 0) {
    return { content: branchOverride.content, source: 'branch_db' };
  }
  if (globalTemplate?.isActive && globalTemplate.content.trim().length > 0) {
    return { content: globalTemplate.content, source: 'global_db' };
  }
  return null;
}

export function buildAdminWhatsAppTemplateView(
  definition: WhatsAppTemplateDefinition,
  rows: MessageTemplateStoredRow[],
  branchId: number,
): AdminWhatsAppTemplateView {
  const scoped = rows.filter((row) => row.templateKey === definition.templateKey);
  const branchOverride = pickPreferredRow(
    scoped.filter((row) => row.branchId === branchId),
  );
  const globalTemplate = pickPreferredRow(
    scoped.filter((row) => row.branchId == null),
  );

  const resolved = resolveTemplateContent(
    definition.templateKey,
    activeLookupHit(branchOverride, globalTemplate),
  );
  const fallback = getCodeDefaultTemplate(definition.templateKey) ?? '';

  return {
    templateKey: definition.templateKey,
    channel: definition.channel,
    language: definition.language,
    label: definition.label,
    description: definition.description,
    availableVariables: definition.availableVariables,
    effectiveContent: resolved?.content ?? fallback,
    effectiveSource: resolved?.source ?? 'code_default',
    branchOverride: toOverrideView(branchOverride),
    globalTemplate: toOverrideView(globalTemplate),
  };
}

function requireKnownDefinition(templateKey: string): WhatsAppTemplateDefinition {
  const definition = getWhatsAppTemplateDefinition(templateKey);
  if (!definition) {
    throw new MessageTemplateAdminError('القالب غير موجود', 404, 'UNKNOWN_TEMPLATE');
  }
  return definition;
}

function assertSupportedLanguage(
  definition: WhatsAppTemplateDefinition,
  language: string | undefined,
): 'ar' {
  const resolved = (language ?? definition.language).trim() || definition.language;
  if (resolved !== definition.language) {
    throw new MessageTemplateAdminError('اللغة غير مدعومة لهذا القالب', 400, 'UNSUPPORTED_LANGUAGE');
  }
  return definition.language;
}

function assertValidContent(definition: WhatsAppTemplateDefinition, content: unknown): string {
  if (typeof content !== 'string') {
    throw new MessageTemplateAdminError('محتوى القالب مطلوب', 400, 'EMPTY_CONTENT');
  }
  const trimmed = content.trim();
  const invalid = validateTemplatePlaceholders(
    trimmed,
    definition.availableVariables.map((variable) => variable.key),
  );
  if (invalid) {
    throw new MessageTemplateAdminError(invalid.message, 400, invalid.code);
  }
  return trimmed;
}

async function loadScopedRows(
  definition: WhatsAppTemplateDefinition,
  branchId: number,
): Promise<MessageTemplateStoredRow[]> {
  return listMessageTemplateRows({
    channel: definition.channel,
    templateKeys: [definition.templateKey],
    language: definition.language,
    branchId,
  });
}

export async function listAdminWhatsAppTemplates(
  branchId: number,
): Promise<AdminWhatsAppTemplateView[]> {
  const definitions = listWhatsAppTemplateDefinitions();
  const rows = await listMessageTemplateRows({
    channel: 'whatsapp',
    templateKeys: definitions.map((definition) => definition.templateKey),
    language: 'ar',
    branchId,
  });
  return definitions.map((definition) =>
    buildAdminWhatsAppTemplateView(definition, rows, branchId),
  );
}

export async function getAdminWhatsAppTemplate(
  branchId: number,
  templateKey: string,
): Promise<AdminWhatsAppTemplateView> {
  const definition = requireKnownDefinition(templateKey);
  const rows = await loadScopedRows(definition, branchId);
  return buildAdminWhatsAppTemplateView(definition, rows, branchId);
}

export async function upsertAdminWhatsAppBranchOverride(input: {
  branchId: number;
  userId: number;
  templateKey: string;
  language?: string;
  content: unknown;
}): Promise<AdminWhatsAppTemplateView> {
  const definition = requireKnownDefinition(input.templateKey);
  const language = assertSupportedLanguage(definition, input.language);
  const content = assertValidContent(definition, input.content);

  await upsertBranchMessageTemplateOverride({
    channel: definition.channel,
    templateKey: definition.templateKey,
    language,
    branchId: input.branchId,
    content,
    userId: input.userId,
  });

  const rows = await loadScopedRows(definition, input.branchId);
  return buildAdminWhatsAppTemplateView(definition, rows, input.branchId);
}

export async function deactivateAdminWhatsAppBranchOverride(input: {
  branchId: number;
  userId: number;
  templateKey: string;
}): Promise<AdminWhatsAppTemplateView> {
  const definition = requireKnownDefinition(input.templateKey);

  await deactivateBranchMessageTemplateOverride({
    channel: definition.channel,
    templateKey: definition.templateKey,
    language: definition.language,
    branchId: input.branchId,
    userId: input.userId,
  });

  const rows = await loadScopedRows(definition, input.branchId);
  return buildAdminWhatsAppTemplateView(definition, rows, input.branchId);
}

export function previewAdminWhatsAppTemplate(input: {
  templateKey: string;
  content: unknown;
}): { ok: true; rendered: string } {
  const definition = requireKnownDefinition(input.templateKey);
  const content = assertValidContent(definition, input.content);

  try {
    return {
      ok: true,
      rendered: renderTemplate(content, sampleVariablesForDefinition(definition)),
    };
  } catch (err) {
    throw new MessageTemplateAdminError(
      err instanceof Error ? err.message : 'تعذر عرض القالب',
      400,
      'RENDER_FAILED',
    );
  }
}
