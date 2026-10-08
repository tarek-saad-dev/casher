import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import {
  getDrvowaOutboundTokenHash,
  hashDrvowaToken,
} from '@/lib/integrations/drvowaConfig';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function requireDrvowaIntegrationAuth(request: Request): Promise<void> {
  const header = request.headers.get('authorization');
  const token =
    header && /^Bearer\s+/i.test(header)
      ? header.replace(/^Bearer\s+/i, '').trim()
      : '';
  if (!token) {
    throw new Error('DRVOWA_INTEGRATION_UNAUTHORIZED');
  }

  const dbHash = await getDrvowaOutboundTokenHash();
  if (dbHash) {
    const tokenHash = hashDrvowaToken(token);
    if (!safeEqual(tokenHash, dbHash)) {
      throw new Error('DRVOWA_INTEGRATION_UNAUTHORIZED');
    }
    return;
  }

  const legacyExpected = process.env.DRVOWA_INTEGRATION_TOKEN?.trim();
  if (!legacyExpected) {
    throw new Error('DRVOWA_INTEGRATION_NOT_CONFIGURED');
  }
  if (!safeEqual(token, legacyExpected)) {
    throw new Error('DRVOWA_INTEGRATION_UNAUTHORIZED');
  }
}

export function drvowaIntegrationErrorResponse(error: unknown): Response {
  const code = error instanceof Error ? error.message : 'DRVOWA_INTEGRATION_ERROR';
  const status =
    code === 'DRVOWA_INTEGRATION_UNAUTHORIZED'
      ? 401
      : code === 'DRVOWA_INTEGRATION_NOT_CONFIGURED'
        ? 503
        : 500;
  return Response.json(
    {
      ok: false,
      error: {
        code,
        message:
          status === 401
            ? 'Unauthorized integration request'
            : status === 503
              ? 'DRVOWA integration is not configured'
              : 'Integration request failed',
      },
    },
    { status },
  );
}
