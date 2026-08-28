#!/usr/bin/env npx tsx
/**
 * Seed default WhatsApp booking group (idempotent).
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const DEFAULT_GROUP = {
  name: 'تنبيهات الحجوزات',
  inviteLink: 'https://chat.whatsapp.com/GyeYhwaMnTjLV7TbO3o7ie',
  subscribedEvents: ['booking.created'] as const,
};

async function main() {
  const { ensureWhatsAppGroupTable, listWhatsAppGroups, createWhatsAppGroup } =
    await import('../src/modules/messaging/groups');

  await ensureWhatsAppGroupTable();
  const existing = await listWhatsAppGroups();
  const match = existing.find(
    (g) => g.inviteLink === DEFAULT_GROUP.inviteLink,
  );

  if (match) {
    console.log('Group already exists:', {
      id: match.id,
      name: match.name,
      events: match.subscribedEvents,
      isActive: match.isActive,
    });
    return;
  }

  const group = await createWhatsAppGroup({
    name: DEFAULT_GROUP.name,
    inviteLink: DEFAULT_GROUP.inviteLink,
    subscribedEvents: [...DEFAULT_GROUP.subscribedEvents],
    isActive: true,
  });

  console.log('Created WhatsApp group:', {
    id: group.id,
    name: group.name,
    inviteLink: group.inviteLink,
    events: group.subscribedEvents,
  });

  const { closePool } = await import('../src/lib/db');
  await closePool();
}

main().catch((e) => {
  console.error('seed failed', e instanceof Error ? e.message : e);
  process.exit(1);
});
