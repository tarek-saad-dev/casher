/**
 * WhatsApp Integration — Centralized Configuration
 *
 * Single source of truth for all environment variables.
 * Do NOT access process.env for WhatsApp settings outside this file.
 * Do NOT prefix with NEXT_PUBLIC_ — never expose to client bundles.
 */

export interface WhatsAppConfig {
  enabled: boolean;
  apiBaseUrl: string;
  timeoutMs: number;
  saleEnabled: boolean;
  bookingEnabled: boolean;
  firstTimeEnabled: boolean;
  employeeSaleEnabled: boolean;
  employeeAdvanceEnabled: boolean;
  employeeFundingEnabled: boolean;
  quickMessageEnabled: boolean;
  employeeDailyReportEnabled: boolean;
  ownerDailyReportEnabled: boolean;
  otherEnabled: boolean;
  defaultBranchName: string;
  defaultBookingLink: string;
  defaultQuickMessage: string;
}

function getWhatsAppConfig(): WhatsAppConfig {
  const isDev = process.env.NODE_ENV === 'development';
  const flagEnabled = process.env.WHATSAPP_INTEGRATION_ENABLED === 'true';

  return {
    enabled: isDev && flagEnabled,
    apiBaseUrl: process.env.WHATSAPP_API_BASE_URL || 'http://localhost:3000',
    timeoutMs: parseInt(process.env.WHATSAPP_REQUEST_TIMEOUT_MS || '90000', 10),
    saleEnabled: process.env.WHATSAPP_SALE_ENABLED !== 'false',
    bookingEnabled: process.env.WHATSAPP_BOOKING_ENABLED !== 'false',
    firstTimeEnabled: process.env.WHATSAPP_FIRST_TIME_ENABLED !== 'false',
    employeeSaleEnabled: process.env.WHATSAPP_EMPLOYEE_SALE_ENABLED !== 'false',
    employeeAdvanceEnabled: process.env.WHATSAPP_EMPLOYEE_ADVANCE_ENABLED !== 'false',
    employeeFundingEnabled: process.env.WHATSAPP_EMPLOYEE_FUNDING_ENABLED !== 'false',
    quickMessageEnabled: process.env.WHATSAPP_QUICK_MESSAGE_ENABLED !== 'false',
    employeeDailyReportEnabled:
      process.env.WHATSAPP_EMPLOYEE_DAILY_REPORT_ENABLED !== 'false',
    ownerDailyReportEnabled:
      process.env.WHATSAPP_OWNER_DAILY_REPORT_ENABLED !== 'false',
    otherEnabled: process.env.WHATSAPP_OTHER_ENABLED !== 'false',
    defaultBranchName: process.env.WHATSAPP_DEFAULT_BRANCH_NAME || 'جليم',
    defaultBookingLink: process.env.WHATSAPP_DEFAULT_BOOKING_LINK || 'https://cutsaloon.com/',
    defaultQuickMessage:
      process.env.WHATSAPP_DEFAULT_QUICK_MESSAGE || 'أهلا بك في Cut Salon',
  };
}

export function getConfig(): WhatsAppConfig {
  return getWhatsAppConfig();
}

export function isWhatsAppEnabled(): boolean {
  return getWhatsAppConfig().enabled;
}
