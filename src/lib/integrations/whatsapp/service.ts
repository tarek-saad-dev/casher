/**
 * WhatsApp Integration — Service Layer
 *
 * The only entry point business modules should call.
 * All functions:
 *   - Are safe to await after a DB commit
 *   - Never throw into the caller
 *   - Return a structured result
 *
 * NOTE: First-time message duplicate protection relies on invoice count
 * in TblinvServHead. It is not guaranteed against every concurrency case
 * because there is no dedicated WhatsApp tracking table in this version.
 * Production delivery is intentionally deferred.
 */

import { getConfig } from './config';
import { sendWhatsAppPayload, fetchWhatsAppStatus } from './client';
import {
  buildSalePayload,
  buildBookingPayload,
  buildFirstTimePayload,
  resolvePhone,
  type SalePayloadInput,
  type BookingPayloadInput,
  type FirstTimePayloadInput,
} from './payload-builders';
import { validateSalePayload, validateBookingPayload, validateFirstTimePayload } from './schemas';
import type { WhatsAppSendResult, WhatsAppStatusResult } from './types';
import { WhatsAppValidationError } from './errors';

export async function sendSaleWhatsAppMessage(
  input: SalePayloadInput,
): Promise<WhatsAppSendResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { sent: false, skipped: true, reason: 'development_only' };
  }

  if (!cfg.saleEnabled) {
    console.log('[whatsapp] Sale message skipped: type disabled');
    return { sent: false, skipped: true, reason: 'message_type_disabled' };
  }

  const phone = resolvePhone(input.phone, undefined);
  if (!phone) {
    console.log('[whatsapp] Sale message skipped: missing phone');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }

  if (!input.customerName?.trim()) {
    console.log('[whatsapp] Sale message skipped: missing customer name');
    return { sent: false, skipped: true, reason: 'missing_customer_name' };
  }

  try {
    const payload = buildSalePayload({ ...input, phone });
    validateSalePayload(payload);
    const result = await sendWhatsAppPayload(payload);
    if (result.sent) {
      console.log(`[whatsapp] Sale message submitted for invoice INV-${input.invID}`);
    }
    return result;
  } catch (err) {
    if (err instanceof WhatsAppValidationError) {
      console.log(`[whatsapp] Sale message skipped: validation — ${err.message}`);
      return { sent: false, skipped: true, reason: 'invalid_payload' };
    }
    console.log(`[whatsapp] Sale message error (non-critical): ${err instanceof Error ? err.message : String(err)}`);
    return { sent: false, skipped: false, reason: 'remote_error' };
  }
}

export async function sendBookingWhatsAppMessage(
  input: BookingPayloadInput,
): Promise<WhatsAppSendResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { sent: false, skipped: true, reason: 'development_only' };
  }

  if (!cfg.bookingEnabled) {
    console.log('[whatsapp] Booking message skipped: type disabled');
    return { sent: false, skipped: true, reason: 'message_type_disabled' };
  }

  const phone = resolvePhone(input.phone, undefined);
  if (!phone) {
    console.log('[whatsapp] Booking message skipped: missing phone');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }

  if (!input.customerName?.trim()) {
    console.log('[whatsapp] Booking message skipped: missing customer name');
    return { sent: false, skipped: true, reason: 'missing_customer_name' };
  }

  try {
    const payload = buildBookingPayload({ ...input, phone });
    validateBookingPayload(payload);
    const result = await sendWhatsAppPayload(payload);
    if (result.sent) {
      console.log(
        `[whatsapp] Booking message submitted for booking BK-${input.bookingId ?? 'unknown'}`,
      );
    }
    return result;
  } catch (err) {
    if (err instanceof WhatsAppValidationError) {
      console.log(`[whatsapp] Booking message skipped: validation — ${err.message}`);
      return { sent: false, skipped: true, reason: 'invalid_payload' };
    }
    console.log(`[whatsapp] Booking message error (non-critical): ${err instanceof Error ? err.message : String(err)}`);
    return { sent: false, skipped: false, reason: 'remote_error' };
  }
}

export async function sendFirstTimeWhatsAppMessage(
  input: FirstTimePayloadInput,
): Promise<WhatsAppSendResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { sent: false, skipped: true, reason: 'development_only' };
  }

  if (!cfg.firstTimeEnabled) {
    console.log('[whatsapp] First-time message skipped: type disabled');
    return { sent: false, skipped: true, reason: 'message_type_disabled' };
  }

  const phone = resolvePhone(input.phone, undefined);
  if (!phone) {
    console.log('[whatsapp] First-time message skipped: missing phone');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }

  if (!input.customerName?.trim()) {
    console.log('[whatsapp] First-time message skipped: missing customer name');
    return { sent: false, skipped: true, reason: 'missing_customer_name' };
  }

  try {
    const payload = buildFirstTimePayload({ ...input, phone });
    validateFirstTimePayload(payload);
    const result = await sendWhatsAppPayload(payload);
    if (result.sent) {
      console.log(`[whatsapp] First-time message submitted for new customer`);
    }
    return result;
  } catch (err) {
    if (err instanceof WhatsAppValidationError) {
      console.log(`[whatsapp] First-time message skipped: validation — ${err.message}`);
      return { sent: false, skipped: true, reason: 'invalid_payload' };
    }
    console.log(`[whatsapp] First-time message error (non-critical): ${err instanceof Error ? err.message : String(err)}`);
    return { sent: false, skipped: false, reason: 'remote_error' };
  }
}

export async function checkWhatsAppStatus(): Promise<WhatsAppStatusResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { available: false, reason: 'development_only' };
  }

  return fetchWhatsAppStatus();
}
