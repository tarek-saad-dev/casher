export type PlaceholderValidationCode =
  | 'EMPTY_CONTENT'
  | 'MALFORMED_PLACEHOLDER'
  | 'UNKNOWN_PLACEHOLDER';

export type PlaceholderValidationError = {
  code: PlaceholderValidationCode;
  message: string;
};

/** Same token shape the sale renderer accepts: {{name}} with optional inner spaces. */
const VALID_PLACEHOLDER_RE = /\{\{\s*([\w]+)\s*\}\}/g;

export function extractTemplatePlaceholders(content: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(VALID_PLACEHOLDER_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      keys.push(match[1]);
    }
  }
  return keys;
}

export function validateTemplatePlaceholders(
  content: string,
  allowedKeys: readonly string[],
): PlaceholderValidationError | null {
  const trimmed = typeof content === 'string' ? content.trim() : '';
  if (!trimmed) {
    return {
      code: 'EMPTY_CONTENT',
      message: 'محتوى القالب مطلوب',
    };
  }

  const stripped = trimmed.replace(/\{\{\s*[\w]+\s*\}\}/g, '');
  if (stripped.includes('{{') || stripped.includes('}}')) {
    return {
      code: 'MALFORMED_PLACEHOLDER',
      message: 'صيغة المتغير غير صحيحة — استخدم {{variableName}}',
    };
  }

  const allowed = new Set(allowedKeys);
  const unknown = extractTemplatePlaceholders(trimmed).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return {
      code: 'UNKNOWN_PLACEHOLDER',
      message: `متغير غير معروف: ${unknown.map((key) => `{{${key}}}`).join(', ')}`,
    };
  }

  return null;
}
