/**
 * WhatsApp Integration — HTTP Client
 *
 * Handles all communication with the separate local WhatsApp Node.js application.
 * Never calls the API in production mode.
 * Never throws unhandled exceptions.
 */

import { getConfig } from './config';
import type {
  WhatsAppPayload,
  WhatsAppSendResult,
  WhatsAppStatusResult,
  WhatsAppApiSendResponse,
  WhatsAppApiStatusResponse,
} from './types';

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
    console.log(`[whatsapp] Remote error HTTP ${response.status}`);
    return {
      sent: false,
      skipped: false,
      reason: 'remote_error',
      httpStatus: response.status,
      error: body.error,
    };
  }

  if (response.ok && body.success) {
    console.log(
      `[whatsapp] ${payload.type} message submitted for ${maskPhone(payload.phone)}`,
    );
    return {
      sent: true,
      skipped: false,
      status: 'submitted',
      type: payload.type,
      sentAt: body.sentAt,
    };
  }

  return {
    sent: false,
    skipped: false,
    reason: 'remote_error',
    httpStatus: response.status,
    error: body.error,
  };
}

export async function fetchWhatsAppStatus(): Promise<WhatsAppStatusResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { available: false, reason: 'development_only' };
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
