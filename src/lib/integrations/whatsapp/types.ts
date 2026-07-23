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
    };

export type WhatsAppStatusResult =
  | {
      available: true;
      chromeConnected: true;
      whatsappReady: true;
      whatsappTabFound: true;
    }
  | {
      available: false;
      reason:
        | 'development_only'
        | 'disabled'
        | 'not_ready'
        | 'timeout'
        | 'connection_failed'
        | 'invalid_response';
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
}

export { PROTECTED_FIELDS };
