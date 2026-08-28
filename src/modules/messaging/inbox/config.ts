/**
 * Inbound WhatsApp inbox configuration.
 * Do NOT access process.env for inbox webhook auth outside this file.
 */

function envVal(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return String(env[name] ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

export function getWhatsAppInboxWebhookToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return envVal('WHATSAPP_INBOX_WEBHOOK_TOKEN', env);
}
