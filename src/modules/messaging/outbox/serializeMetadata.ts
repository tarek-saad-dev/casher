import { MessageOutboxError } from '../domain/outboxTypes';

const FORBIDDEN_METADATA_KEY =
  /(password|passwd|secret|token|cookie|authorization|credential|connectionstring|connection_string|api[_-]?key|session[_-]?id)/i;

function assertSafeMetadataKeys(value: unknown, depth: number): void {
  if (depth > 8) {
    throw new MessageOutboxError('Metadata is nested too deeply', 'INVALID_METADATA');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeMetadataKeys(item, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_METADATA_KEY.test(key)) {
        throw new MessageOutboxError(
          'Metadata must not include secrets, tokens, cookies, or credentials',
          'INVALID_METADATA',
        );
      }
      assertSafeMetadataKeys(nested, depth + 1);
    }
  }
}

export function serializeOutboxMetadata(metadata?: Record<string, unknown> | null): string | null {
  if (metadata == null) return null;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new MessageOutboxError('Metadata must be a JSON object', 'INVALID_METADATA');
  }
  assertSafeMetadataKeys(metadata, 0);
  try {
    return JSON.stringify(metadata);
  } catch {
    throw new MessageOutboxError('Metadata could not be serialized as JSON', 'INVALID_METADATA');
  }
}

export function parseOutboxMetadataJson(json: string | null | undefined): Record<string, unknown> | null {
  if (json == null || json === '') return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
