import { renderTemplate } from '../templates/renderTemplate';
import {
  lookupActiveMessageTemplate,
  type MessageTemplateLookupResult,
} from '../templates/repository/messageTemplateRepository';
import {
  CODE_DEFAULT_TEMPLATES,
  type WhatsAppTemplateKey,
} from '../templates/catalog';
import {
  MessageTemplateError,
  type ComposeMessageInput,
  type ComposeMessageResult,
  type MessageTemplateSource,
} from '../domain/templateTypes';

export type MessageTemplateKey = WhatsAppTemplateKey;

export type { ComposeMessageInput, ComposeMessageResult };
export { MessageTemplateError };

export function getCodeDefaultTemplate(templateKey: string): string | null {
  const template = CODE_DEFAULT_TEMPLATES[templateKey];
  return template && template.trim().length > 0 ? template : null;
}

export type TemplateLookupFn = (
  input: Parameters<typeof lookupActiveMessageTemplate>[0],
) => Promise<MessageTemplateLookupResult | null>;

/**
 * Resolve + render a business message.
 * Sale/features must not touch SQL — lookup stays behind this boundary.
 */
export async function composeMessage(
  input: ComposeMessageInput,
  deps?: { lookupActiveTemplate?: TemplateLookupFn },
): Promise<ComposeMessageResult> {
  const templateKey = String(input.templateKey ?? '').trim();
  const channel = input.context?.channel ?? 'whatsapp';
  const language = input.context?.language ?? 'ar';
  const branchId = input.context?.branchId;
  const variables = input.variables ?? input.data ?? {};

  if (!templateKey) {
    throw new MessageTemplateError('templateKey is required', 'UNKNOWN_TEMPLATE');
  }

  const lookup = deps?.lookupActiveTemplate ?? lookupActiveMessageTemplate;
  let dbHit: MessageTemplateLookupResult | null = null;
  try {
    dbHit = await lookup({
      channel,
      templateKey,
      language,
      branchId: typeof branchId === 'number' ? branchId : null,
    });
  } catch (err) {
    console.log(
      `[messaging] Template DB lookup failed for ${templateKey} — using code default if available (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const resolved = resolveTemplateContent(templateKey, dbHit);
  if (!resolved) {
    throw new MessageTemplateError(
      `Unknown message template: ${templateKey}`,
      'UNKNOWN_TEMPLATE',
    );
  }

  try {
    return {
      text: renderTemplate(resolved.content, variables),
      source: resolved.source,
    };
  } catch (err) {
    throw new MessageTemplateError(
      err instanceof Error ? err.message : String(err),
      'RENDER_FAILED',
    );
  }
}

export function resolveTemplateContent(
  templateKey: string,
  dbHit: MessageTemplateLookupResult | null,
): { content: string; source: MessageTemplateSource } | null {
  if (dbHit && dbHit.content.trim().length > 0) {
    return { content: dbHit.content, source: dbHit.source };
  }

  const codeDefault = getCodeDefaultTemplate(templateKey);
  if (codeDefault) {
    return { content: codeDefault, source: 'code_default' };
  }

  return null;
}
