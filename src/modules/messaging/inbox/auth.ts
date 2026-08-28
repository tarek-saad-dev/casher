import { NextRequest, NextResponse } from 'next/server';
import {
  isWhatsAppInboxWebhookAuthorized,
} from '@/lib/proxyPublicRoutes';
import { getWhatsAppInboxWebhookToken } from './config';

export { isWhatsAppInboxWebhookAuthorized } from '@/lib/proxyPublicRoutes';

export function requireWhatsAppInboxWebhookAuth(
  req: NextRequest,
  env: { WHATSAPP_INBOX_WEBHOOK_TOKEN?: string; NODE_ENV?: string } = process.env,
): true | NextResponse {
  if (isWhatsAppInboxWebhookAuthorized(req.headers.get('authorization'), env)) {
    return true;
  }
  return NextResponse.json(
    { ok: false, error: 'غير مصرح — WHATSAPP_INBOX_WEBHOOK_TOKEN (Bearer) مطلوب' },
    { status: 401 },
  );
}

export function isWhatsAppInboxWebhookAuthResult(
  value: true | NextResponse,
): value is true {
  return value === true;
}

/** Test helper — never use in production route handlers. */
export function resolveWhatsAppInboxWebhookTokenForTests(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return getWhatsAppInboxWebhookToken(env) || 'dev';
}
