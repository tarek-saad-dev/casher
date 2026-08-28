#!/usr/bin/env npx tsx
/**
 * Dry-run: simulate booking.created group notification (no gateway send).
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

async function main() {
  const { listActiveGroupsForEvent } = await import('../src/modules/messaging/groups');
  const { buildGroupMessageForEvent } = await import(
    '../src/modules/messaging/groups/application/buildGroupMessage'
  );

  const groups = await listActiveGroupsForEvent('booking.created', 1);
  const message = buildGroupMessageForEvent('booking.created', {
    customerName: 'اختبار النظام',
    bookingId: 9999,
    bookingDate: '2026-08-28',
    bookingTime: '15:30',
    barberName: 'حلاق تجريبي',
    services: ['قص شعر'],
    branchName: 'Camp Caesar',
  });

  console.log('Would notify groups:', groups.map((g) => ({ id: g.id, name: g.name })));
  console.log('\nMessage preview:\n');
  console.log(message);

  const { closePool } = await import('../src/lib/db');
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
