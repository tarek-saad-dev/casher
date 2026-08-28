/**
 * WhatsApp Integration — Type Definitions
 */

export type WhatsAppMessageType =
  | 'sale'
  | 'booking'
  | 'first_time'
  | 'employee_sale'
  | 'employee_advance'
  | 'employee_funding'
  | 'quick_message'
  | 'employee_daily_report'
  | 'other';

export type WhatsAppExtraVariables = Record<string, string | number | boolean | null | string[]>;

const PROTECTED_FIELDS = ['type', 'phone', 'customerName'] as const;
export type ProtectedField = (typeof PROTECTED_FIELDS)[number];

export interface WhatsAppBasePayload {
  type: WhatsAppMessageType;
  phone: string;
  customerName: string;
}

export interface SaleWhatsAppPayload extends WhatsAppBasePayload {
  type: 'sale';
  invoiceNumber?: string;
  total?: number;
  paymentMethod?: string;
  branchName?: string;
  employeeName?: string;
  services?: string[];
  variables?: WhatsAppExtraVariables;
}

export interface BookingWhatsAppPayload extends WhatsAppBasePayload {
  type: 'booking';
  bookingId?: string;
  bookingDate: string;
  bookingTime: string;
  branchName?: string;
  barberName?: string;
  services?: string[];
  bookingLink?: string;
  variables?: WhatsAppExtraVariables;
}

export interface FirstTimeWhatsAppPayload extends WhatsAppBasePayload {
  type: 'first_time';
  branchName?: string;
  bookingLink?: string;
  variables?: WhatsAppExtraVariables;
}

export interface EmployeeSaleWhatsAppPayload extends WhatsAppBasePayload {
  type: 'employee_sale';
  invoiceNumber?: string;
  invoiceId?: number;
  employeeId?: number;
  employeeName?: string;
  clientName?: string;
  employeeTotal?: number;
  invoiceTotal?: number;
  branchName?: string;
  services?: string[];
  message?: string;
  serviceDetails?: Array<{
    detailId?: number;
    proId: number;
    name: string;
    grossAmount: number;
    discountValue: number;
    netAmount: number;
  }>;
  variables?: WhatsAppExtraVariables;
}

export interface EmployeeAdvanceWhatsAppPayload extends WhatsAppBasePayload {
  type: 'employee_advance';
  invoiceNumber?: string;
  amount?: number;
  paymentMethod?: string;
  branchName?: string;
  notes?: string;
  variables?: WhatsAppExtraVariables;
}

/** Employee funding the shop (income mapped to employee) — distinct from advance. */
export interface EmployeeFundingWhatsAppPayload extends WhatsAppBasePayload {
  type: 'employee_funding';
  invoiceNumber?: string;
  amount?: number;
  paymentMethod?: string;
  branchName?: string;
  notes?: string;
  variables?: WhatsAppExtraVariables;
}

/** Free-text quick send from POS (script must support type=quick_message). */
export interface QuickMessageWhatsAppPayload extends WhatsAppBasePayload {
  type: 'quick_message';
  message: string;
  branchName?: string;
  variables?: WhatsAppExtraVariables;
}

/** End-of-day employee HR digest — bot prefers `message` when present. */
export interface EmployeeDailyReportWhatsAppPayload extends WhatsAppBasePayload {
  type: 'employee_daily_report';
  message: string;
  branchName?: string;
  workDate: string;
  employeeName?: string;
  checkIn?: string | null;
  checkOut?: string | null;
  actualHours?: number | null;
  scheduledHours?: number | null;
  statusLabelAr?: string | null;
  lateMinutes?: number | null;
  baseWage?: number | null;
  fullDayBase?: number | null;
  isPartialDay?: boolean;
  baseWageNoteAr?: string | null;
  targetSales?: number | null;
  targetAmount?: number | null;
  deductions?: number | null;
  advances?: number | null;
  dayNet?: number | null;
  ledgerBalance: number;
  payrollMonth?: string;
  variables?: WhatsAppExtraVariables;
}

/**
 * Free-text message composed in the POS — bot sends `message` as-is
 * (no local template on the WhatsApp script side).
 */
export interface OtherWhatsAppPayload extends WhatsAppBasePayload {
  type: 'other';
  message: string;
  branchName?: string;
  variables?: WhatsAppExtraVariables;
}

export type WhatsAppPayload =
  | SaleWhatsAppPayload
  | BookingWhatsAppPayload
  | FirstTimeWhatsAppPayload
  | EmployeeSaleWhatsAppPayload
  | EmployeeAdvanceWhatsAppPayload
  | EmployeeFundingWhatsAppPayload
  | QuickMessageWhatsAppPayload
  | EmployeeDailyReportWhatsAppPayload
  | OtherWhatsAppPayload;

export interface GenericWhatsAppMessageInput {
  phone: string;
  message: string;
  metadata?: Record<string, unknown>;
  /** Optional Gateway delivery key. Omitted from the wire when unset. */
  idempotencyKey?: string;
}

export interface GenericWhatsAppGroupMessageInput {
  groupInviteLink: string;
  message: string;
}

export interface WhatsAppApiGroupSendResponse {
  ok?: boolean;
  success?: boolean;
  status?: 'sent' | 'failed' | 'group_not_accessible' | 'group_not_found' | string;
  messageId?: string;
  type?: string;
  target?: string;
  chatId?: string;
  message?: string;
  sentAt?: string;
  error?: string;
  code?: string;
}

export type WhatsAppSendFailure =
  | {
      sent: false;
      skipped: true;
      reason:
        | 'development_only'
        | 'disabled'
        | 'message_type_disabled'
        | 'missing_phone'
        | 'missing_customer_name'
        | 'invalid_payload';
    }
  | {
      sent: false;
      skipped: false;
      reason:
        | 'invalid_phone'
        | 'whatsapp_not_ready'
        | 'timeout'
        | 'connection_failed'
        | 'remote_error'
        | 'invalid_response'
        | 'not_registered'
        | 'failed'
        | 'queued';
      httpStatus?: number;
      error?: string;
      status?: string;
      messageId?: string;
      /** Gateway error code when present (e.g. IDEMPOTENCY_IN_PROGRESS). */
      code?: string;
    };

export type WhatsAppSendResult =
  | {
      sent: true;
      skipped: false;
      status: 'sent' | 'queued';
      type: WhatsAppMessageType;
      phone?: string;
      messageId?: string;
      sentAt?: string;
    }
  | WhatsAppSendFailure;

/** Gateway generic send — no `type` field. Success requires sent + messageId. */
export type GenericWhatsAppSendResult =
  | {
      sent: true;
      skipped: false;
      status: 'sent';
      phone?: string;
      messageId: string;
      sentAt?: string;
    }
  | WhatsAppSendFailure;

/** Gateway group send — POST /api/whatsapp/send-group. */
export type GenericWhatsAppGroupSendResult =
  | {
      sent: true;
      skipped: false;
      status: 'sent';
      messageId: string;
      sentAt?: string;
      target?: string;
    }
  | WhatsAppSendFailure;

/**
 * Phase 8 Pure Gateway status.
 * `available` = gateway reachable (health ok + status JSON parsed).
 * Session readiness is the boolean flags — not collapsed into unavailable.
 */
export type WhatsAppStatusResult =
  | {
      available: true;
      chromeConnected: boolean;
      whatsappReady: boolean;
      whatsappTabFound: boolean;
      /** All session flags true — WhatsApp ready to send. */
      connected: boolean;
    }
  | {
      available: false;
      reason:
        | 'development_only'
        | 'disabled'
        | 'timeout'
        | 'connection_failed'
        | 'invalid_response';
    };

/** Lightweight GET /api/health probe — not used on the POS send path. */
export type WhatsAppBotHealthResult =
  | { ok: true; httpStatus: number }
  | {
      ok: false;
      reason:
        | 'development_only'
        | 'timeout'
        | 'connection_failed'
        | 'invalid_response';
      httpStatus?: number;
    };

export interface WhatsAppApiStatusResponse {
  success: boolean;
  chromeConnected?: boolean;
  whatsappReady?: boolean;
  debugPort?: number;
  profileDirectory?: string;
  profileName?: string;
  whatsappTabFound?: boolean;
}

export interface WhatsAppApiSendResponse {
  ok?: boolean;
  success?: boolean;
  status?: 'sent' | 'queued' | 'failed' | 'not_registered' | 'submitted' | string;
  messageId?: string;
  type?: string;
  phone?: string;
  message?: string;
  sentAt?: string;
  error?: string;
  code?: string;
}

export { PROTECTED_FIELDS };
