/**
 * WhatsApp Integration — Service Layer (Phase 8)
 *
 * Generic Gateway + status/health only.
 * Business features use @/modules/messaging (sendTemplateMessage / sendMessage).
 * Every call targets an explicit bridge endpoint: the sending tenant's channel.
 */

import { getConfig } from './config';
import {
  sendGenericWhatsAppPayload,
  sendGenericWhatsAppGroupPayload,
  fetchWhatsAppStatus,
  fetchWhatsAppBotHealth,
} from './client';
import type {
  WhatsAppSendFailure,
  WhatsAppStatusResult,
  WhatsAppBotHealthResult,
  GenericWhatsAppMessageInput,
  GenericWhatsAppGroupMessageInput,
  GenericWhatsAppSendResult,
  GenericWhatsAppGroupSendResult,
  WhatsAppEndpoint,
} from './types';

/** Master switch only — never gates on NODE_ENV. */
function skipIfIntegrationDisabled(): WhatsAppSendFailure | null {
  if (getConfig().enabled) return null;
  console.log(
    '[whatsapp] Integration skipped: WHATSAPP_INTEGRATION_ENABLED is not true',
  );
  return { sent: false, skipped: true, reason: 'development_only' };
}

function hasEndpoint(endpoint: WhatsAppEndpoint | null | undefined): endpoint is WhatsAppEndpoint {
  return typeof endpoint?.apiBaseUrl === 'string' && endpoint.apiBaseUrl.trim().length > 0;
}

/**
 * Generic Gateway send. Does not set `type` on the wire.
 */
export async function sendWhatsAppMessage(
  input: GenericWhatsAppMessageInput,
  endpoint: WhatsAppEndpoint,
): Promise<GenericWhatsAppSendResult> {
  const disabled = skipIfIntegrationDisabled();
  if (disabled) return disabled;

  if (!hasEndpoint(endpoint)) {
    console.log('[whatsapp] Generic message skipped: no tenant channel endpoint');
    return { sent: false, skipped: true, reason: 'channel_not_configured' };
  }

  if (typeof input.phone !== 'string' || input.phone.trim().length === 0) {
    console.log('[whatsapp] Generic message skipped: missing phone');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }

  if (typeof input.message !== 'string' || input.message.trim().length === 0) {
    console.log('[whatsapp] Generic message skipped: empty message');
    return { sent: false, skipped: true, reason: 'invalid_payload' };
  }

  try {
    return await sendGenericWhatsAppPayload(
      {
        phone: input.phone,
        message: input.message,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
          ? { idempotencyKey: input.idempotencyKey.trim() }
          : {}),
      },
      endpoint,
    );
  } catch (err) {
    console.log(
      `[whatsapp] Generic message error (non-critical): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { sent: false, skipped: false, reason: 'remote_error' };
  }
}

/**
 * Generic Gateway group send via invite link.
 */
export async function sendWhatsAppGroupMessage(
  input: GenericWhatsAppGroupMessageInput,
  endpoint: WhatsAppEndpoint,
): Promise<GenericWhatsAppGroupSendResult> {
  const disabled = skipIfIntegrationDisabled();
  if (disabled) return disabled;

  if (!hasEndpoint(endpoint)) {
    console.log('[whatsapp] Group message skipped: no tenant channel endpoint');
    return { sent: false, skipped: true, reason: 'channel_not_configured' };
  }

  const inviteLink =
    typeof input.groupInviteLink === 'string' ? input.groupInviteLink.trim() : '';
  if (!inviteLink) {
    console.log('[whatsapp] Group message skipped: missing invite link');
    return { sent: false, skipped: true, reason: 'invalid_payload' };
  }

  if (typeof input.message !== 'string' || input.message.trim().length === 0) {
    console.log('[whatsapp] Group message skipped: empty message');
    return { sent: false, skipped: true, reason: 'invalid_payload' };
  }

  try {
    return await sendGenericWhatsAppGroupPayload(
      {
        groupInviteLink: inviteLink,
        message: input.message,
      },
      endpoint,
    );
  } catch (err) {
    console.log(
      `[whatsapp] Group message error (non-critical): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { sent: false, skipped: false, reason: 'remote_error' };
  }
}

export async function checkWhatsAppStatus(endpoint: WhatsAppEndpoint): Promise<WhatsAppStatusResult> {
  if (!getConfig().enabled) {
    return { available: false, reason: 'development_only' };
  }
  if (!hasEndpoint(endpoint)) {
    return { available: false, reason: 'channel_not_configured' };
  }

  return fetchWhatsAppStatus(endpoint);
}

/** Server-side GET /api/health — does not run on invoice/POS send. */
export async function checkWhatsAppBotHealth(
  endpoint: WhatsAppEndpoint,
): Promise<WhatsAppBotHealthResult> {
  if (!getConfig().enabled) {
    return { ok: false, reason: 'development_only' };
  }
  if (!hasEndpoint(endpoint)) {
    return { ok: false, reason: 'channel_not_configured' };
  }

  return fetchWhatsAppBotHealth(endpoint);
}
