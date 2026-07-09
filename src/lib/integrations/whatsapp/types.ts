/**
 * WhatsApp Integration — Type Definitions
 */

export type WhatsAppMessageType =
  | 'sale'
  | 'booking'
  | 'first_time'
  | 'employee_sale'
  | 'employee_advance';

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
  branchName?: string;
  services?: string[];
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

export type WhatsAppPayload =
  | SaleWhatsAppPayload
  | BookingWhatsAppPayload
  | FirstTimeWhatsAppPayload
  | EmployeeSaleWhatsAppPayload
  | EmployeeAdvanceWhatsAppPayload;

export type WhatsAppSendResult =
  | {
      sent: true;
      skipped: false;
      status: 'submitted';
      type: WhatsAppMessageType;
      phone?: string;
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
        | 'invalid_response';
      httpStatus?: number;
      error?: string;
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
  success: boolean;
  status?: string;
  type?: string;
  phone?: string;
  message?: string;
  sentAt?: string;
  error?: string;
}

export { PROTECTED_FIELDS };
