/**
 * WhatsApp Integration — HTTP Client
 *
 * Handles all communication with the local WhatsApp bot (loopback only).
 * Never calls the bot when WHATSAPP_INTEGRATION_ENABLED is not true.
 * Never throws unhandled exceptions.
 */

import { getConfig } from './config';
import type {
  WhatsAppPayload,
  WhatsAppSendResult,
  WhatsAppStatusResult,
  WhatsAppBotHealthResult,
  WhatsAppApiSendResponse,
  WhatsAppApiStatusResponse,
} from './types';

const HEALTH_TIMEOUT_MS = 5000;

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, 3) + '****' + phone.slice(-2);
}

export async function sendWhatsAppPayload(
  payload: WhatsAppPayload,
): Promise<WhatsAppSendResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    console.log('[whatsapp] Integration skipped outside development');
    return { sent: false, skipped: true, reason: 'development_only' };
  }

  const url = `${cfg.apiBaseUrl}/api/whatsapp/send`;

  let response: Response;
  let responseText: string;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      msg.includes('abort') ||
      msg.toLowerCase().includes('timeout') ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      console.log(`[whatsapp] Request timed out for ${payload.type}`);
      return { sent: false, skipped: false, reason: 'timeout' };
    }

    console.log(`[whatsapp] Connection failed — is the WhatsApp app running? (${msg})`);
    return { sent: false, skipped: false, reason: 'connection_failed' };
  }

  try {
    responseText = await response.text();
  } catch {
    return {
      sent: false,
      skipped: false,
      reason: 'invalid_response',
      httpStatus: response.status,
    };
  }

  let body: WhatsAppApiSendResponse;
  try {
    body = JSON.parse(responseText) as WhatsAppApiSendResponse;
  } catch {
    return {
      sent: false,
      skipped: false,
      reason: 'invalid_response',
      httpStatus: response.status,
    };
  }

  if (response.status === 503) {
    console.log('[whatsapp] WhatsApp Web is not ready');
    return {
      sent: false,
      skipped: false,
      reason: 'whatsapp_not_ready',
      httpStatus: 503,
    };
  }

  if (response.status === 400) {
    const errorMsg = body.error || '';
    const remoteStatus = body.status;
    console.log(`[whatsapp] Remote validation/error (${payload.type}): status=${remoteStatus || 'n/a'} ${errorMsg}`);
    if (remoteStatus === 'not_registered') {
      return {
        sent: false,
        skipped: false,
        reason: 'not_registered',
        httpStatus: 400,
        error: errorMsg,
        status: 'not_registered',
      };
    }
    if (errorMsg.toLowerCase().includes('phone') || errorMsg.toLowerCase().includes('invalid')) {
      return {
        sent: false,
        skipped: false,
        reason: 'invalid_phone',
        httpStatus: 400,
        error: errorMsg,
      };
    }
    return {
      sent: false,
      skipped: false,
      reason: 'invalid_response',
      httpStatus: 400,
      error: errorMsg,
    };
  }

  if (response.status >= 500) {
    console.log(`[whatsapp] Remote error HTTP ${response.status} status=${body.status || 'n/a'}`);
    return {
      sent: false,
      skipped: false,
      reason: body.status === 'failed' ? 'failed' : 'remote_error',
      httpStatus: response.status,
      error: body.error,
      status: body.status,
    };
  }

  // Real send only: success=true, status=sent, messageId present.
  // Do NOT treat ok=true, queued, or legacy "submitted" as sent.
  if (response.ok && body.success === true && body.status === 'sent' && body.messageId) {
    console.log(
      `[whatsapp] ${payload.type} sent for ${maskPhone(payload.phone)} messageId=${body.messageId}`,
    );
    return {
      sent: true,
      skipped: false,
      status: 'sent',
      type: payload.type,
      phone: body.phone,
      messageId: body.messageId,
      sentAt: body.sentAt,
    };
  }

  if (response.ok && body.success === true && body.status === 'queued') {
    console.log(
      `[whatsapp] ${payload.type} queued for ${maskPhone(payload.phone)}`,
    );
    return {
      sent: false,
      skipped: false,
      reason: 'queued',
      status: 'queued',
    };
  }

  console.log(
    `[whatsapp] ${payload.type} unconfirmed for ${maskPhone(payload.phone)} status=${body.status || 'n/a'} messageId=${body.messageId || 'missing'} — treating as failed`,
  );
  return {
    sent: false,
    skipped: false,
    reason: 'invalid_response',
    httpStatus: response.status,
    error:
      body.error ||
      `Bot did not confirm sent/messageId (success=${String(body.success)} status=${body.status || 'n/a'})`,
    status: body.status,
  };
}

/**
 * GET /api/health on the bot. Used by status/nightly checks only — never by POS send.
 */
export async function fetchWhatsAppBotHealth(): Promise<WhatsAppBotHealthResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { ok: false, reason: 'development_only' };
  }

  const url = `${cfg.apiBaseUrl}/api/health`;

  let response: Response;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      msg.includes('abort') ||
      msg.toLowerCase().includes('timeout') ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      return { ok: false, reason: 'timeout' };
    }

    return { ok: false, reason: 'connection_failed' };
  }

  if (response.ok) {
    return { ok: true, httpStatus: response.status };
  }

  return {
    ok: false,
    reason: 'invalid_response',
    httpStatus: response.status,
  };
}

export async function fetchWhatsAppStatus(): Promise<WhatsAppStatusResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { available: false, reason: 'development_only' };
  }

  const health = await fetchWhatsAppBotHealth();
  if (
    !health.ok &&
    (health.reason === 'connection_failed' || health.reason === 'timeout')
  ) {
    return { available: false, reason: health.reason };
  }

  const url = `${cfg.apiBaseUrl}/api/whatsapp/status`;

  let response: Response;
  let responseText: string;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      msg.includes('abort') ||
      msg.toLowerCase().includes('timeout') ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      return { available: false, reason: 'timeout' };
    }

    return { available: false, reason: 'connection_failed' };
  }

  try {
    responseText = await response.text();
  } catch {
    return { available: false, reason: 'invalid_response' };
  }

  let body: WhatsAppApiStatusResponse;
  try {
    body = JSON.parse(responseText) as WhatsAppApiStatusResponse;
  } catch {
    return { available: false, reason: 'invalid_response' };
  }

  if (
    body.success === true &&
    body.chromeConnected === true &&
    body.whatsappReady === true &&
    body.whatsappTabFound === true
  ) {
    return {
      available: true,
      chromeConnected: true,
      whatsappReady: true,
      whatsappTabFound: true,
    };
  }

  return { available: false, reason: 'not_ready' };
}
