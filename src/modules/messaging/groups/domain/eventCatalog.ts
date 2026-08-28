import type { WhatsAppGroupEventKey } from './types';

export type WhatsAppGroupEventDefinition = {
  key: WhatsAppGroupEventKey;
  labelAr: string;
  descriptionAr: string;
};

/** Events available for group subscription in admin UI. */
export const WHATSAPP_GROUP_EVENTS: WhatsAppGroupEventDefinition[] = [
  {
    key: 'booking.created',
    labelAr: 'حجز جديد',
    descriptionAr: 'عند إنشاء حجز جديد (عام أو داخلي)',
  },
  {
    key: 'booking.cancelled',
    labelAr: 'إلغاء حجز',
    descriptionAr: 'عند إلغاء حجز',
  },
  {
    key: 'booking.moved',
    labelAr: 'تعديل موعد حجز',
    descriptionAr: 'عند نقل أو تعديل موعد حجز',
  },
  {
    key: 'sale.completed',
    labelAr: 'فاتورة مبيعات',
    descriptionAr: 'عند إتمام فاتورة مبيعات جديدة',
  },
];

const VALID_EVENT_KEYS = new Set<string>(
  WHATSAPP_GROUP_EVENTS.map((e) => e.key),
);

export function isValidWhatsAppGroupEventKey(
  value: string,
): value is WhatsAppGroupEventKey {
  return VALID_EVENT_KEYS.has(value);
}

export function normalizeSubscribedEvents(
  events: unknown,
): WhatsAppGroupEventKey[] {
  if (!Array.isArray(events)) return [];
  const seen = new Set<WhatsAppGroupEventKey>();
  const out: WhatsAppGroupEventKey[] = [];
  for (const item of events) {
    const key = String(item ?? '').trim();
    if (isValidWhatsAppGroupEventKey(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}
