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
  WhatsAppSendFailure,
  WhatsAppStatusResult,
  WhatsAppBotHealthResult,
  WhatsAppApiSendResponse,
  WhatsAppApiGroupSendResponse,
  WhatsAppApiStatusResponse,
  GenericWhatsAppMessageInput,
  GenericWhatsAppGroupMessageInput,
  GenericWhatsAppSendResult,
  GenericWhatsAppGroupSendResult,
} from './types';

const HEALTH_TIMEOUT_MS = 5000;

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, 3) + '****' + phone.slice(-2);
}

function maskGroupLink(link: string): string {
  const trimmed = link.trim();
  if (trimmed.length <= 24) return '****';
  return `${trimmed.slice(0, 20)}****`;
}

function isTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('abort') ||
    msg.toLowerCase().includes('timeout') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

type GatewaySendConfirmed = {
  sent: true;
  skipped: false;
  status: 'sent';
  phone?: string;
  messageId: string;
  sentAt?: string;
};

/**
 * Shared POST /api/whatsapp/send + response mapping.
 * Does not add a `type` field to the result — callers attach it if needed.
 */
async function postWhatsAppSend(
  requestBody: unknown,
  logLabel: string,
  phone: string,
): Promise<GatewaySendConfirmed | WhatsAppSendFailure> {
  const cfg = getConfig();
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
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (isTimeoutError(err)) {
      console.log(`[whatsapp] Request timed out for ${logLabel}`);
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

  const gatewayCode =
    typeof body.code === 'string' && body.code.trim().length > 0 ? body.code.trim() : undefined;

  if (response.status === 503) {
    console.log('[whatsapp] WhatsApp Web is not ready');
    return {
      sent: false,
      skipped: false,
      reason: 'whatsapp_not_ready',
      httpStatus: 503,
      error: body.error,
      status: body.status,
      ...(gatewayCode ? { code: gatewayCode } : {}),
    };
  }

  if (response.status === 409) {
    console.log(`[whatsapp] Gateway conflict/in-progress (${logLabel}): ${gatewayCode || 'n/a'}`);
    return {
      sent: false,
      skipped: false,
      reason: 'remote_error',
      httpStatus: 409,
      error: body.error,
      status: body.status,
      ...(gatewayCode ? { code: gatewayCode } : {}),
    };
  }

  if (response.status === 400) {
    const errorMsg = body.error || '';
    const remoteStatus = body.status;
    console.log(`[whatsapp] Remote validation/error (${logLabel}): status=${remoteStatus || 'n/a'} ${errorMsg}`);
    if (remoteStatus === 'not_registered') {
      return {
        sent: false,
        skipped: false,
        reason: 'not_registered',
        httpStatus: 400,
        error: errorMsg,
        status: 'not_registered',
        ...(gatewayCode ? { code: gatewayCode } : {}),
      };
    }
    if (errorMsg.toLowerCase().includes('phone') || errorMsg.toLowerCase().includes('invalid')) {
      return {
        sent: false,
        skipped: false,
        reason: 'invalid_phone',
        httpStatus: 400,
        error: errorMsg,
        ...(gatewayCode ? { code: gatewayCode } : {}),
      };
    }
    return {
      sent: false,
      skipped: false,
      reason: 'invalid_response',
      httpStatus: 400,
      error: errorMsg,
      ...(gatewayCode ? { code: gatewayCode } : {}),
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
      ...(gatewayCode ? { code: gatewayCode } : {}),
    };
  }

  // Real send only: success=true, status=sent, messageId present.
  // Do NOT treat ok=true, queued, or legacy "submitted" as sent.
  if (response.ok && body.success === true && body.status === 'sent' && body.messageId) {
    console.log(
      `[whatsapp] ${logLabel} sent for ${maskPhone(phone)} messageId=${body.messageId}`,
    );
    return {
      sent: true,
      skipped: false,
      status: 'sent',
      phone: body.phone,
      messageId: body.messageId,
      sentAt: body.sentAt,
    };
  }

  if (response.ok && body.success === true && body.status === 'queued') {
    console.log(
      `[whatsapp] ${logLabel} queued for ${maskPhone(phone)}`,
    );
    return {
      sent: false,
      skipped: false,
      reason: 'queued',
      status: 'queued',
    };
  }

  console.log(
    `[whatsapp] ${logLabel} unconfirmed for ${maskPhone(phone)} status=${body.status || 'n/a'} messageId=${body.messageId || 'missing'} — treating as failed`,
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
    ...(gatewayCode ? { code: gatewayCode } : {}),
  };
}

function skipIfClientDisabled(): WhatsAppSendFailure | null {
  if (getConfig().enabled) return null;
  console.log(
    '[whatsapp] Integration skipped: WHATSAPP_INTEGRATION_ENABLED is not true',
  );
  return { sent: false, skipped: true, reason: 'development_only' };
}

/**
 * @deprecated Phase 8 — typed Gateway payloads removed. Prefer sendGenericWhatsAppPayload.
 * Kept only so old unit helpers compile if imported; production must not call this.
 */
export async function sendWhatsAppPayload(
  payload: WhatsAppPayload,
): Promise<WhatsAppSendResult> {
  const disabled = skipIfClientDisabled();
  if (disabled) return disabled;

  // Typed contract removed from bot — refuse rather than POST `type`.
  console.log(
    `[whatsapp] Typed payload rejected (Phase 8 gateway is generic-only): type=${payload.type}`,
  );
  return {
    sent: false,
    skipped: true,
    reason: 'typed_send_removed',
  };
}

/**
 * POST /api/whatsapp/send-group — group invite link + message.
 */
async function postWhatsAppGroupSend(
  requestBody: unknown,
  logLabel: string,
  groupInviteLink: string,
): Promise<GenericWhatsAppGroupSendResult> {
  const cfg = getConfig();
  const url = `${cfg.apiBaseUrl}/api/whatsapp/send-group`;

  let response: Response;
  let responseText: string;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (isTimeoutError(err)) {
      console.log(`[whatsapp] Group request timed out for ${logLabel}`);
      return { sent: false, skipped: false, reason: 'timeout' };
    }

    console.log(`[whatsapp] Group connection failed — is the WhatsApp app running? (${msg})`);
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

  let body: WhatsAppApiGroupSendResponse;
  try {
    body = JSON.parse(responseText) as WhatsAppApiGroupSendResponse;
  } catch {
    return {
      sent: false,
      skipped: false,
      reason: 'invalid_response',
      httpStatus: response.status,
    };
  }

  const gatewayCode =
    typeof body.code === 'string' && body.code.trim().length > 0 ? body.code.trim() : undefined;

  if (response.status === 503) {
    console.log('[whatsapp] WhatsApp Web is not ready (group send)');
    return {
      sent: false,
      skipped: false,
      reason: 'whatsapp_not_ready',
      httpStatus: 503,
      error: body.error,
      status: body.status,
      ...(gatewayCode ? { code: gatewayCode } : {}),
    };
  }

  if (response.status === 404 || body.status === 'group_not_found') {
    console.log(`[whatsapp] Group not found (${logLabel})`);
    return {
      sent: false,
      skipped: false,
      reason: 'remote_error',
      httpStatus: response.status,
      error: body.error ?? 'group_not_found',
      status: body.status ?? 'group_not_found',
      ...(gatewayCode ? { code: gatewayCode } : {}),
    };
  }

  if (response.status === 400 && body.status === 'group_not_accessible') {
    console.log(`[whatsapp] Group not accessible (${logLabel})`);
    return {
      sent: false,
      skipped: false,
      reason: 'remote_error',
      httpStatus: 400,
      error: body.error ?? 'group_not_accessible',
      status: 'group_not_accessible',
      ...(gatewayCode ? { code: gatewayCode } : {}),
    };
  }

  if (response.status === 400) {
    const errorMsg = body.error || '';
    console.log(`[whatsapp] Group validation/error (${logLabel}): ${errorMsg}`);
    return {
      sent: false,
      skipped: false,
      reason: 'invalid_response',
      httpStatus: 400,
      error: errorMsg,
      ...(gatewayCode ? { code: gatewayCode } : {}),
    };
  }

  if (response.status >= 500) {
    console.log(`[whatsapp] Group remote error HTTP ${response.status}`);
    return {
      sent: false,
      skipped: false,
      reason: body.status === 'failed' ? 'failed' : 'remote_error',
      httpStatus: response.status,
      error: body.error,
      status: body.status,
      ...(gatewayCode ? { code: gatewayCode } : {}),
    };
  }

  if (response.ok && body.success === true && body.status === 'sent' && body.messageId) {
    console.log(
      `[whatsapp] ${logLabel} group sent for ${maskGroupLink(groupInviteLink)} messageId=${body.messageId}`,
    );
    return {
      sent: true,
      skipped: false,
      status: 'sent',
      messageId: body.messageId,
      sentAt: body.sentAt,
      target: body.target,
    };
  }

  console.log(
    `[whatsapp] ${logLabel} group unconfirmed for ${maskGroupLink(groupInviteLink)} status=${body.status || 'n/a'}`,
  );
  return {
    sent: false,
    skipped: false,
    reason: 'invalid_response',
    httpStatus: response.status,
    error:
      body.error ||
      `Bot did not confirm group sent/messageId (success=${String(body.success)} status=${body.status || 'n/a'})`,
    status: body.status,
    ...(gatewayCode ? { code: gatewayCode } : {}),
  };
}

/**
 * Untyped Gateway send. Body is { phone, message, metadata? } — never includes `type`.
 */
export async function sendGenericWhatsAppPayload(
  input: GenericWhatsAppMessageInput,
): Promise<GenericWhatsAppSendResult> {
  const disabled = skipIfClientDisabled();
  if (disabled) return disabled;

  const body: Record<string, unknown> = {
    phone: input.phone,
    message: input.message,
  };
  if (input.metadata !== undefined) {
    body.metadata = input.metadata;
  }
  const idempotencyKey =
    typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (idempotencyKey) {
    body.idempotencyKey = idempotencyKey;
  }

  return postWhatsAppSend(body, 'generic', input.phone);
}

/**
 * Untyped Gateway group send. Body is { groupInviteLink, message }.
 */
export async function sendGenericWhatsAppGroupPayload(
  input: GenericWhatsAppGroupMessageInput,
): Promise<GenericWhatsAppGroupSendResult> {
  const disabled = skipIfClientDisabled();
  if (disabled) return disabled;

  const body = {
    groupInviteLink: input.groupInviteLink,
    message: input.message,
  };

  return postWhatsAppGroupSend(body, 'group', input.groupInviteLink);
}

/**
 * GET /api/health on the Pure Gateway.
 * Healthy only when HTTP succeeds and body has status === "ok".
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

  if (!response.ok) {
    return {
      ok: false,
      reason: 'invalid_response',
      httpStatus: response.status,
    };
  }

  let body: { status?: unknown };
  try {
    body = (await response.json()) as { status?: unknown };
  } catch {
    return {
      ok: false,
      reason: 'invalid_response',
      httpStatus: response.status,
    };
  }

  if (body?.status === 'ok') {
    return { ok: true, httpStatus: response.status };
  }

  return {
    ok: false,
    reason: 'invalid_response',
    httpStatus: response.status,
  };
}

/**
 * GET /api/whatsapp/status — Phase 8 Pure Gateway contract.
 * Gateway unavailable only on network/config/invalid response.
 * Session not-ready returns available:true with connected:false.
 */
export async function fetchWhatsAppStatus(): Promise<WhatsAppStatusResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { available: false, reason: 'development_only' };
  }

  const health = await fetchWhatsAppBotHealth();
  if (!health.ok) {
    if (health.reason === 'connection_failed' || health.reason === 'timeout') {
      return { available: false, reason: health.reason };
    }
    // Health reachable but payload not status:"ok" — still try status endpoint;
    // only hard-fail unavailable when status fetch itself cannot run.
    if (health.reason === 'development_only') {
      return { available: false, reason: 'development_only' };
    }
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

  if (!response.ok) {
    return { available: false, reason: 'invalid_response' };
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

  if (typeof body?.success !== 'boolean') {
    return { available: false, reason: 'invalid_response' };
  }

  const chromeConnected = body.chromeConnected === true;
  const whatsappReady = body.whatsappReady === true;
  const whatsappTabFound = body.whatsappTabFound === true;
  const connected =
    body.success === true && chromeConnected && whatsappReady && whatsappTabFound;

  return {
    available: true,
    chromeConnected,
    whatsappReady,
    whatsappTabFound,
    connected,
  };
}
