/**
 * WhatsApp Integration — Public API
 *
 * Import from this file only.
 */

export {
  sendSaleWhatsAppMessage,
  sendBookingWhatsAppMessage,
  sendFirstTimeWhatsAppMessage,
  sendEmployeeSaleWhatsAppMessage,
  sendEmployeeAdvanceWhatsAppMessage,
  sendEmployeeFundingWhatsAppMessage,
  sendQuickWhatsAppMessage,
  sendEmployeeDailyReportWhatsAppMessage,
  checkWhatsAppStatus,
} from './service';

export { isWhatsAppEnabled, getConfig as getWhatsAppConfig } from './config';

export type {
  WhatsAppSendResult,
  WhatsAppStatusResult,
  WhatsAppMessageType,
  WhatsAppPayload,
  SaleWhatsAppPayload,
  BookingWhatsAppPayload,
  FirstTimeWhatsAppPayload,
  EmployeeSaleWhatsAppPayload,
  EmployeeAdvanceWhatsAppPayload,
  EmployeeFundingWhatsAppPayload,
  QuickMessageWhatsAppPayload,
  EmployeeDailyReportWhatsAppPayload,
  WhatsAppExtraVariables,
} from './types';
