/**
 * WhatsApp Integration — Centralized Configuration
 *
 * Single source of truth for all environment variables.
 * Do NOT access process.env for WhatsApp settings outside this file.
 * Do NOT prefix with NEXT_PUBLIC_ — never expose to client bundles.
 *
 * Reads use bracket access + trim/quote-stripping (same pattern as db.ts /
 * cloudinary) so production .env.local values are honored at runtime.
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

/** Runtime env read — avoids fragile exact-string matches on quoted/spaced values. */
function envVal(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return String(env[name] ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

/** Explicit opt-in flags (WHATSAPP_INTEGRATION_ENABLED). */
function envEnabled(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = envVal(name, env).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Opt-out flags (default on unless explicitly false). */
function envDisabled(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = envVal(name, env).toLowerCase();
  return v === '0' || v === 'false' || v === 'no' || v === 'off';
}

function resolveApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = envVal('WHATSAPP_API_BASE_URL', env);
  return (raw || 'http://127.0.0.1:3001').replace(/\/+$/, '');
}

function getWhatsAppConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  return {
    // Master switch only — NOT gated on NODE_ENV.
    enabled: envEnabled('WHATSAPP_INTEGRATION_ENABLED', env),
    apiBaseUrl: resolveApiBaseUrl(env),
    timeoutMs: parseInt(envVal('WHATSAPP_REQUEST_TIMEOUT_MS', env) || '90000', 10),
    saleEnabled: !envDisabled('WHATSAPP_SALE_ENABLED', env),
    bookingEnabled: !envDisabled('WHATSAPP_BOOKING_ENABLED', env),
    firstTimeEnabled: !envDisabled('WHATSAPP_FIRST_TIME_ENABLED', env),
    employeeSaleEnabled: !envDisabled('WHATSAPP_EMPLOYEE_SALE_ENABLED', env),
    employeeAdvanceEnabled: !envDisabled('WHATSAPP_EMPLOYEE_ADVANCE_ENABLED', env),
    employeeFundingEnabled: !envDisabled('WHATSAPP_EMPLOYEE_FUNDING_ENABLED', env),
    quickMessageEnabled: !envDisabled('WHATSAPP_QUICK_MESSAGE_ENABLED', env),
    employeeDailyReportEnabled: !envDisabled('WHATSAPP_EMPLOYEE_DAILY_REPORT_ENABLED', env),
    ownerDailyReportEnabled: !envDisabled('WHATSAPP_OWNER_DAILY_REPORT_ENABLED', env),
    otherEnabled: !envDisabled('WHATSAPP_OTHER_ENABLED', env),
    defaultBranchName: envVal('WHATSAPP_DEFAULT_BRANCH_NAME', env) || 'جليم',
    defaultBookingLink:
      envVal('WHATSAPP_DEFAULT_BOOKING_LINK', env) || 'https://cutsaloon.com/',
    defaultQuickMessage:
      envVal('WHATSAPP_DEFAULT_QUICK_MESSAGE', env) || 'أهلا بك في Cut Salon',
  };
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  return getWhatsAppConfig(env);
}

export function isWhatsAppEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getWhatsAppConfig(env).enabled;
}
