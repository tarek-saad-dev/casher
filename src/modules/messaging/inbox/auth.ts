import { NextRequest, NextResponse } from 'next/server';
import { logSecurityEvent } from '@/lib/api-auth';
import { findActiveChannelByTokenHash } from '../tenancy/channelRepository';
import { extractBearerToken, hashChannelWebhookToken } from '../tenancy/channelToken';
import { runWithMessagingTenant } from '../tenancy/messagingTenantScope';
import { recordMessagingUsage } from '../tenancy/usage';

export { isWhatsAppInboxWebhookAuthorized } from '@/lib/proxyPublicRoutes';

/** Inbound webhook identity: the tenant channel whose webhook token authenticated the call. */
export type WhatsAppChannelWebhookAuth = {
  ok: true;
  tenantId: string;
  channelId: string;
  provider: string;
};

type ChannelLookup = typeof findActiveChannelByTokenHash;

/**
 * Bearer token → sha256 → active TenantMessagingChannel of an active tenant.
 * Unknown / pending / disabled channels fail closed with 401; there is no shared fallback token.
 */
export async function requireWhatsAppInboxWebhookAuth(
  req: NextRequest,
  deps: { findChannel?: ChannelLookup } = {},
): Promise<WhatsAppChannelWebhookAuth | NextResponse> {
  const token = extractBearerToken(req.headers.get('authorization'));
  const channel = token
    ? await (deps.findChannel ?? findActiveChannelByTokenHash)(hashChannelWebhookToken(token))
    : null;
  if (channel) {
    return { ok: true, tenantId: channel.tenantId, channelId: channel.channelId, provider: channel.provider };
  }
  logSecurityEvent('messaging_webhook_unknown_channel', {
    path: req.nextUrl?.pathname ?? null,
    bearerPresent: Boolean(token),
  });
  return NextResponse.json(
    { ok: false, error: 'غير مصرح — رمز قناة واتساب غير معروف' },
    { status: 401 },
  );
}

export function isWhatsAppInboxWebhookAuthResult(
  value: WhatsAppChannelWebhookAuth | NextResponse,
): value is WhatsAppChannelWebhookAuth {
  return !(value instanceof NextResponse) && value.ok === true;
}

/** Runs webhook work inside the channel tenant's messaging scope. */
export function runWithWebhookMessagingTenant<T>(
  auth: WhatsAppChannelWebhookAuth,
  detail: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithMessagingTenant(
    { tenantId: auth.tenantId, source: 'webhook', detail: `${detail}:channel:${auth.channelId}` },
    fn,
  );
}

/** Inbound metering for the channel tenant (call inside the webhook scope). */
export async function recordInboundMessageUsage(): Promise<void> {
  await recordMessagingUsage('inbound_message');
}
