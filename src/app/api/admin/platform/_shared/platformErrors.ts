import { NextResponse } from 'next/server';
import { TenantAppError } from '@/platform/apps/errors';
import { BootstrapTenantProtectedError } from '@/platform/commercial/bootstrapGuard';
import { CommercialError } from '@/platform/commercial/errors';
import { TenantOnboardingError } from '@/platform/onboarding/errors';
import { TenantLockTimeoutError } from '@/platform/tenant/tenantApplock';

/** Map platform domain errors to JSON responses; null for unexpected errors. */
export function platformErrorResponse(err: unknown): NextResponse | null {
  if (
    err instanceof TenantOnboardingError ||
    err instanceof TenantAppError ||
    err instanceof CommercialError
  ) {
    const details = 'details' in err ? err.details : undefined;
    return NextResponse.json(
      { error: err.message, code: err.code, ...(details ? { details } : {}) },
      { status: err.status },
    );
  }
  if (err instanceof PlatformRequestError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof BootstrapTenantProtectedError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof TenantLockTimeoutError) {
    return NextResponse.json(
      { error: 'Tenant is busy with another platform operation; retry shortly.', code: 'LOCK_TIMEOUT' },
      { status: 409 },
    );
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function invalidTenantIdResponse(tenantId: string): NextResponse | null {
  if (UUID_RE.test(tenantId)) return null;
  return NextResponse.json({ error: 'Invalid tenant id', code: 'TENANT_ID_INVALID' }, { status: 400 });
}

export class PlatformRequestError extends Error {
  readonly code = 'INVALID_REQUEST';
  readonly status = 400;
}

/** Optional string array field: undefined/null -> [], anything other than an array of strings -> 400. */
export function readStringArray(value: unknown, field = 'value'): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new PlatformRequestError(`${field} must be an array of strings`);
  }
  return value;
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new PlatformRequestError('Request body must be valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PlatformRequestError('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}
