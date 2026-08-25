import { describe, expect, it } from 'vitest';
import { whatsappSourceLabel } from '@/lib/whatsapp/adminTemplateUi';

describe('whatsappSourceLabel', () => {
  it('maps effective sources to Arabic badges', () => {
    expect(whatsappSourceLabel('branch_db')).toBe('رسالة مخصصة لهذا الفرع');
    expect(whatsappSourceLabel('global_db')).toBe('الرسالة العامة');
    expect(whatsappSourceLabel('code_default')).toBe('الرسالة الافتراضية للنظام');
  });
});
