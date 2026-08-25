/**
 * WhatsApp Integration — Public API (Phase 8 pure gateway boundary)
 *
 * Production features must use @/modules/messaging
 * (sendTemplateMessage / sendMessage / campaigns → outbox).
 *
 * This module only exposes Generic Gateway + status/health + config.
 */

export {
  sendWhatsAppMessage,
  checkWhatsAppStatus,
  checkWhatsAppBotHealth,
} from './service';

export { isWhatsAppEnabled, getConfig as getWhatsAppConfig } from './config';

export type {
  WhatsAppSendResult,
  WhatsAppStatusResult,
  WhatsAppBotHealthResult,
  GenericWhatsAppMessageInput,
  GenericWhatsAppSendResult,
} from './types';
