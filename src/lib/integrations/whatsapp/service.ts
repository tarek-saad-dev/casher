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
  buildEmployeeSalePayload,
  buildEmployeeAdvancePayload,
  buildEmployeeFundingPayload,
  buildQuickMessagePayload,
  buildEmployeeDailyReportPayload,
  resolvePhone,
  resolveEmployeeWhatsAppPhone,
  type SalePayloadInput,
  type BookingPayloadInput,
  type FirstTimePayloadInput,
  type EmployeeSalePayloadInput,
  type EmployeeAdvancePayloadInput,
  type EmployeeFundingPayloadInput,
  type QuickMessagePayloadInput,
  type EmployeeDailyReportPayloadInput,
} from './payload-builders';
import {
  validateSalePayload,
  validateBookingPayload,
  validateFirstTimePayload,
  validateEmployeeSalePayload,
  validateEmployeeAdvancePayload,
  validateEmployeeFundingPayload,
  validateQuickMessagePayload,
  validateEmployeeDailyReportPayload,
} from './schemas';
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

export async function sendEmployeeSaleWhatsAppMessage(
  input: EmployeeSalePayloadInput,
): Promise<WhatsAppSendResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { sent: false, skipped: true, reason: 'development_only' };
  }

  if (!cfg.employeeSaleEnabled) {
    console.log('[whatsapp] Employee sale message skipped: type disabled');
    return { sent: false, skipped: true, reason: 'message_type_disabled' };
  }

  const phone = resolvePhone(input.phone, undefined);
  if (!phone) {
    console.log('[whatsapp] Employee sale message skipped: missing phone');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }

  if (!input.employeeName?.trim()) {
    console.log('[whatsapp] Employee sale message skipped: missing employee name');
    return { sent: false, skipped: true, reason: 'missing_customer_name' };
  }

  if (!input.services?.length) {
    console.log('[whatsapp] Employee sale message skipped: no services');
    return { sent: false, skipped: true, reason: 'invalid_payload' };
  }

  try {
    const payload = buildEmployeeSalePayload({ ...input, phone });
    validateEmployeeSalePayload(payload);
    const result = await sendWhatsAppPayload(payload);
    if (result.sent) {
      console.log(
        `[whatsapp] Employee sale message submitted for invoice INV-${input.invID} -> ${input.employeeName}`,
      );
    } else if (!result.skipped) {
      const detail =
        'error' in result && result.error
          ? result.error
          : 'reason' in result
            ? result.reason
            : 'unknown';
      console.log(
        `[whatsapp] Employee sale message failed for INV-${input.invID} -> ${input.employeeName}: ${detail}`,
      );
    }
    return result;
  } catch (err) {
    if (err instanceof WhatsAppValidationError) {
      console.log(`[whatsapp] Employee sale message skipped: validation — ${err.message}`);
      return { sent: false, skipped: true, reason: 'invalid_payload' };
    }
    console.log(
      `[whatsapp] Employee sale message error (non-critical): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { sent: false, skipped: false, reason: 'remote_error' };
  }
}

export async function sendEmployeeAdvanceWhatsAppMessage(
  input: EmployeeAdvancePayloadInput,
): Promise<WhatsAppSendResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { sent: false, skipped: true, reason: 'development_only' };
  }

  if (!cfg.employeeAdvanceEnabled) {
    console.log('[whatsapp] Employee advance message skipped: type disabled');
    return { sent: false, skipped: true, reason: 'message_type_disabled' };
  }

  const phone = resolvePhone(input.phone, undefined);
  if (!phone) {
    console.log('[whatsapp] Employee advance message skipped: missing phone');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }

  if (!input.employeeName?.trim()) {
    console.log('[whatsapp] Employee advance message skipped: missing employee name');
    return { sent: false, skipped: true, reason: 'missing_customer_name' };
  }

  if (!input.amount || input.amount <= 0) {
    console.log('[whatsapp] Employee advance message skipped: invalid amount');
    return { sent: false, skipped: true, reason: 'invalid_payload' };
  }

  try {
    const payload = buildEmployeeAdvancePayload({ ...input, phone });
    validateEmployeeAdvancePayload(payload);
    const result = await sendWhatsAppPayload(payload);
    if (result.sent) {
      console.log(
        `[whatsapp] Employee advance message submitted for ADV-${input.invID} -> ${input.employeeName}`,
      );
    } else if (!result.skipped) {
      const detail =
        'error' in result && result.error
          ? result.error
          : 'reason' in result
            ? result.reason
            : 'unknown';
      console.log(
        `[whatsapp] Employee advance message failed for ADV-${input.invID} -> ${input.employeeName}: ${detail}`,
      );
    }
    return result;
  } catch (err) {
    if (err instanceof WhatsAppValidationError) {
      console.log(`[whatsapp] Employee advance message skipped: validation — ${err.message}`);
      return { sent: false, skipped: true, reason: 'invalid_payload' };
    }
    console.log(
      `[whatsapp] Employee advance message error (non-critical): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { sent: false, skipped: false, reason: 'remote_error' };
  }
}

export async function sendEmployeeFundingWhatsAppMessage(
  input: EmployeeFundingPayloadInput,
): Promise<WhatsAppSendResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { sent: false, skipped: true, reason: 'development_only' };
  }

  if (!cfg.employeeFundingEnabled) {
    console.log('[whatsapp] Employee funding message skipped: type disabled');
    return { sent: false, skipped: true, reason: 'message_type_disabled' };
  }

  const phone = resolvePhone(input.phone, undefined);
  if (!phone) {
    console.log('[whatsapp] Employee funding message skipped: missing phone');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }

  if (!input.employeeName?.trim()) {
    console.log('[whatsapp] Employee funding message skipped: missing employee name');
    return { sent: false, skipped: true, reason: 'missing_customer_name' };
  }

  if (!input.amount || input.amount <= 0) {
    console.log('[whatsapp] Employee funding message skipped: invalid amount');
    return { sent: false, skipped: true, reason: 'invalid_payload' };
  }

  try {
    const payload = buildEmployeeFundingPayload({ ...input, phone });
    validateEmployeeFundingPayload(payload);
    const result = await sendWhatsAppPayload(payload);
    if (result.sent) {
      console.log(
        `[whatsapp] Employee funding message submitted for FUND-${input.invID} -> ${input.employeeName}`,
      );
    } else if (!result.skipped) {
      const detail =
        'error' in result && result.error
          ? result.error
          : 'reason' in result
            ? result.reason
            : 'unknown';
      console.log(
        `[whatsapp] Employee funding message failed for FUND-${input.invID} -> ${input.employeeName}: ${detail}`,
      );
    }
    return result;
  } catch (err) {
    if (err instanceof WhatsAppValidationError) {
      console.log(`[whatsapp] Employee funding message skipped: validation — ${err.message}`);
      return { sent: false, skipped: true, reason: 'invalid_payload' };
    }
    console.log(
      `[whatsapp] Employee funding message error (non-critical): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { sent: false, skipped: false, reason: 'remote_error' };
  }
}

export async function sendQuickWhatsAppMessage(
  input: QuickMessagePayloadInput,
): Promise<WhatsAppSendResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { sent: false, skipped: true, reason: 'development_only' };
  }

  if (!cfg.quickMessageEnabled) {
    console.log('[whatsapp] Quick message skipped: type disabled');
    return { sent: false, skipped: true, reason: 'message_type_disabled' };
  }

  const phone = resolvePhone(input.phone, undefined);
  if (!phone) {
    console.log('[whatsapp] Quick message skipped: missing phone');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }

  try {
    const payload = buildQuickMessagePayload({ ...input, phone });
    validateQuickMessagePayload(payload);
    const result = await sendWhatsAppPayload(payload);
    if (result.sent) {
      console.log('[whatsapp] Quick message submitted');
    }
    return result;
  } catch (err) {
    if (err instanceof WhatsAppValidationError) {
      console.log(`[whatsapp] Quick message skipped: validation — ${err.message}`);
      return { sent: false, skipped: true, reason: 'invalid_payload' };
    }
    console.log(
      `[whatsapp] Quick message error (non-critical): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { sent: false, skipped: false, reason: 'remote_error' };
  }
}

export async function sendEmployeeDailyReportWhatsAppMessage(
  input: EmployeeDailyReportPayloadInput,
): Promise<WhatsAppSendResult> {
  const cfg = getConfig();

  if (!cfg.enabled) {
    return { sent: false, skipped: true, reason: 'development_only' };
  }

  if (!cfg.employeeDailyReportEnabled) {
    console.log('[whatsapp] Employee daily report skipped: type disabled');
    return { sent: false, skipped: true, reason: 'message_type_disabled' };
  }

  const phone = resolvePhone(input.phone, undefined);
  if (!phone) {
    console.log('[whatsapp] Employee daily report skipped: missing phone');
    return { sent: false, skipped: true, reason: 'missing_phone' };
  }

  if (!input.employeeName?.trim()) {
    console.log('[whatsapp] Employee daily report skipped: missing employee name');
    return { sent: false, skipped: true, reason: 'missing_customer_name' };
  }

  if (!input.message?.trim()) {
    console.log('[whatsapp] Employee daily report skipped: empty message');
    return { sent: false, skipped: true, reason: 'invalid_payload' };
  }

  try {
    const payload = buildEmployeeDailyReportPayload({ ...input, phone });
    validateEmployeeDailyReportPayload(payload);
    const result = await sendWhatsAppPayload(payload);
    if (result.sent) {
      console.log(
        `[whatsapp] Employee daily report submitted for ${input.workDate} -> ${input.employeeName}`,
      );
    }
    return result;
  } catch (err) {
    if (err instanceof WhatsAppValidationError) {
      console.log(
        `[whatsapp] Employee daily report skipped: validation — ${err.message}`,
      );
      return { sent: false, skipped: true, reason: 'invalid_payload' };
    }
    console.log(
      `[whatsapp] Employee daily report error (non-critical): ${err instanceof Error ? err.message : String(err)}`,
    );
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
