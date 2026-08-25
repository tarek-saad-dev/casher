import type { MessageTemplateSource } from '@/modules/messaging/domain/templateTypes';

export function whatsappSourceLabel(source: MessageTemplateSource): string {
  if (source === 'branch_db') return 'رسالة مخصصة لهذا الفرع';
  if (source === 'global_db') return 'الرسالة العامة';
  return 'الرسالة الافتراضية للنظام';
}

export function whatsappSourceBadgeVariant(
  source: MessageTemplateSource,
): 'default' | 'secondary' | 'outline' {
  if (source === 'branch_db') return 'default';
  if (source === 'global_db') return 'secondary';
  return 'outline';
}
