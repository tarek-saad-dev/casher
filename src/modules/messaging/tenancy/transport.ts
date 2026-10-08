import {
  checkWhatsAppBotHealth,
  checkWhatsAppStatus,
  sendWhatsAppGroupMessage,
  sendWhatsAppMessage,
} from '@/lib/integrations/whatsapp';
import type {
  GenericWhatsAppGroupMessageInput,
  GenericWhatsAppGroupSendResult,
  GenericWhatsAppMessageInput,
  GenericWhatsAppSendResult,
  WhatsAppBotHealthResult,
  WhatsAppStatusResult,
} from '@/lib/integrations/whatsapp';
import { getActiveChannelForTenant, type ActiveTenantMessagingChannel } from './channelRepository';
import { requireMessagingTenantId } from './messagingTenantScope';
import { recordMessagingUsage } from './usage';

/**
 * Provider transport bound to one tenant channel. V1 ships the bridge transport (one bridge
 * process/session per channel endpoint); other providers implement the same contract.
 */
export interface MessagingTransport {
  send(
    channel: ActiveTenantMessagingChannel,
    input: GenericWhatsAppMessageInput,
  ): Promise<GenericWhatsAppSendResult>;
  sendGroup(
    channel: ActiveTenantMessagingChannel,
    input: GenericWhatsAppGroupMessageInput,
  ): Promise<GenericWhatsAppGroupSendResult>;
  status(channel: ActiveTenantMessagingChannel): Promise<WhatsAppStatusResult>;
  health(channel: ActiveTenantMessagingChannel): Promise<WhatsAppBotHealthResult>;
}

export const bridgeMessagingTransport: MessagingTransport = {
  send: (channel, input) => sendWhatsAppMessage(input, { apiBaseUrl: channel.endpointUrl }),
  sendGroup: (channel, input) => sendWhatsAppGroupMessage(input, { apiBaseUrl: channel.endpointUrl }),
  status: (channel) => checkWhatsAppStatus({ apiBaseUrl: channel.endpointUrl }),
  health: (channel) => checkWhatsAppBotHealth({ apiBaseUrl: channel.endpointUrl }),
};

let transport: MessagingTransport = bridgeMessagingTransport;
let channelResolver: (tenantId: string) => Promise<ActiveTenantMessagingChannel | null> =
  getActiveChannelForTenant;

/** Test seams: fake transport / channel directory (pass null to restore). */
export function setMessagingTransportForTests(next: MessagingTransport | null): void {
  transport = next ?? bridgeMessagingTransport;
}

export function setMessagingChannelResolverForTests(
  next: ((tenantId: string) => Promise<ActiveTenantMessagingChannel | null>) | null,
): void {
  channelResolver = next ?? getActiveChannelForTenant;
}

export async function resolveCurrentTenantChannel(
  where: string,
): Promise<ActiveTenantMessagingChannel | null> {
  return channelResolver(requireMessagingTenantId(where));
}

const CHANNEL_NOT_CONFIGURED = {
  sent: false,
  skipped: true,
  reason: 'channel_not_configured',
} as const;

/** Sends through the current tenant's active channel; no channel → skipped, never another tenant's. */
export async function sendViaTenantChannel(
  input: GenericWhatsAppMessageInput,
): Promise<GenericWhatsAppSendResult> {
  const channel = await resolveCurrentTenantChannel('sendViaTenantChannel');
  if (!channel) return CHANNEL_NOT_CONFIGURED;
  const result = await transport.send(channel, input);
  if (result.sent) await recordMessagingUsage('outbound_sent');
  else if (!result.skipped) await recordMessagingUsage('outbound_failed');
  return result;
}

export async function sendGroupViaTenantChannel(
  input: GenericWhatsAppGroupMessageInput,
): Promise<GenericWhatsAppGroupSendResult> {
  const channel = await resolveCurrentTenantChannel('sendGroupViaTenantChannel');
  if (!channel) return CHANNEL_NOT_CONFIGURED;
  const result = await transport.sendGroup(channel, input);
  if (result.sent) await recordMessagingUsage('group_sent');
  return result;
}

export async function tenantChannelStatus(): Promise<WhatsAppStatusResult> {
  const channel = await resolveCurrentTenantChannel('tenantChannelStatus');
  if (!channel) return { available: false, reason: 'channel_not_configured' };
  return transport.status(channel);
}

export async function tenantChannelHealth(): Promise<WhatsAppBotHealthResult> {
  const channel = await resolveCurrentTenantChannel('tenantChannelHealth');
  if (!channel) return { ok: false, reason: 'channel_not_configured' };
  return transport.health(channel);
}
