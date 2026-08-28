import { describe, it, expect } from 'vitest';
import {
  isValidWhatsAppGroupInviteLink,
  normalizeWhatsAppGroupInviteLink,
} from '@/modules/messaging/groups/domain/inviteLink';
import { normalizeSubscribedEvents } from '@/modules/messaging/groups/domain/eventCatalog';
import { buildGroupMessageForEvent } from '@/modules/messaging/groups/application/buildGroupMessage';

describe('WhatsApp group invite links', () => {
  it('accepts chat.whatsapp.com links', () => {
    const link = 'https://chat.whatsapp.com/GyeYhwaMnTjLV7TbO3o7ie';
    expect(isValidWhatsAppGroupInviteLink(link)).toBe(true);
    expect(normalizeWhatsAppGroupInviteLink(`  ${link}  `)).toBe(link);
  });

  it('accepts web.whatsapp.com accept links', () => {
    expect(
      isValidWhatsAppGroupInviteLink(
        'https://web.whatsapp.com/accept?code=GyeYhwaMnTjLV7TbO3o7ie',
      ),
    ).toBe(true);
  });

  it('rejects invalid links', () => {
    expect(isValidWhatsAppGroupInviteLink('https://example.com/group')).toBe(false);
    expect(isValidWhatsAppGroupInviteLink('')).toBe(false);
  });
});

describe('WhatsApp group subscribed events', () => {
  it('normalizes and dedupes valid events', () => {
    expect(
      normalizeSubscribedEvents([
        'booking.created',
        'booking.created',
        'invalid',
        'sale.completed',
      ]),
    ).toEqual(['booking.created', 'sale.completed']);
  });
});

describe('buildGroupMessageForEvent', () => {
  it('builds booking.created team message', () => {
    const text = buildGroupMessageForEvent('booking.created', {
      customerName: 'أحمد',
      bookingId: 42,
      bookingDate: '2026-08-28',
      bookingTime: '15:00',
      barberName: 'محمد',
      services: ['قص شعر', 'لحية'],
      branchName: 'Camp Caesar',
    });
    expect(text).toContain('حجز جديد');
    expect(text).toContain('أحمد');
    expect(text).toContain('BK-42');
    expect(text).toContain('قص شعر');
  });
});
