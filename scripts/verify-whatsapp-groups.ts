#!/usr/bin/env npx tsx
/**
 * Verify WhatsApp groups setup: DB row + gateway status + test send.
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const GROUP_LINK = 'https://chat.whatsapp.com/GyeYhwaMnTjLV7TbO3o7ie';

async function main() {
  const { listWhatsAppGroups, listActiveGroupsForEvent, sendTestGroupMessage } =
    await import('../src/modules/messaging/groups');
  const { checkWhatsAppStatus, checkWhatsAppBotHealth } = await import(
    '../src/lib/integrations/whatsapp'
  );
  const { getConfig } = await import('../src/lib/integrations/whatsapp/config');

  const cfg = getConfig();
  console.log('=== WhatsApp config ===');
  console.log({
    enabled: cfg.enabled,
    apiBaseUrl: cfg.apiBaseUrl,
    bookingEnabled: cfg.bookingEnabled,
  });

  const groups = await listWhatsAppGroups();
  const bookingGroups = await listActiveGroupsForEvent('booking.created');
  const target = groups.find((g) => g.inviteLink === GROUP_LINK);

  console.log('\n=== Database groups ===');
  console.log(`total: ${groups.length}`);
  if (target) {
    console.log('target group:', {
      id: target.id,
      name: target.name,
      events: target.subscribedEvents,
      isActive: target.isActive,
    });
  } else {
    console.error('ERROR: target group not found in DB');
    process.exitCode = 1;
  }
  console.log(`active booking.created subscribers: ${bookingGroups.length}`);

  console.log('\n=== Gateway health ===');
  const health = await checkWhatsAppBotHealth();
  const status = await checkWhatsAppStatus();
  console.log({ health, status });

  if (!cfg.enabled) {
    console.warn('\nSKIP test send: WHATSAPP_INTEGRATION_ENABLED is not true');
    return;
  }

  if (!target) return;

  if (status.available && status.connected) {
    console.log('\n=== Test group send ===');
    const result = await sendTestGroupMessage(
      target.id,
      '✅ اختبار نظام Cut Salon — تنبيهات الحجوزات جاهزة',
    );
    console.log(result);
    if (!result.sent) {
      console.error('Test send failed:', result.reason);
      process.exitCode = 1;
    }
  } else {
    console.warn('\nSKIP test send: WhatsApp gateway not ready');
    console.warn('Ensure Chrome + WhatsApp Web are running on the bot server.');
  }

  const { closePool } = await import('../src/lib/db');
  await closePool();
}

main().catch((e) => {
  console.error('verify failed', e instanceof Error ? e.message : e);
  process.exit(1);
});
