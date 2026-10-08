import 'server-only';

import { timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function requireDrvowaIntegrationAuth(request: Request): void {
  const expected = process.env.DRVOWA_INTEGRATION_TOKEN?.trim();
  if (!expected) {
    throw new Error('DRVOWA_INTEGRATION_NOT_CONFIGURED');
  }
  const header = request.headers.get('authorization');
  const token =
    header && /^Bearer\s+/i.test(header)
      ? header.replace(/^Bearer\s+/i, '').trim()
      : '';
  if (!token || !safeEqual(token, expected)) {
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
