import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function src(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8');
}

describe('Phase 5A/5C1 does not change current send paths', () => {
  it('leaves POST /api/sales on sendSaleCustomerReceipt (not enqueueMessage)', () => {
    const text = src('src/app/api/sales/route.ts');
    expect(text).toContain('sendSaleCustomerReceipt');
    expect(text).toContain("@/modules/messaging");
    expect(text).not.toContain('enqueueMessage');
    expect(text).not.toContain('TblMessageOutbox');
    expect(text).not.toContain('listMessageHistory');
    expect(text).not.toContain('processOutboxTick');
    expect(text).not.toContain('messaging-outbox-worker');
  });

  it('leaves Quick Message on sendMessage (not enqueueMessage)', () => {
    const text = src('src/app/api/pos/whatsapp/quick-send/route.ts');
    expect(text).toContain('sendMessage');
    expect(text).toContain("@/modules/messaging");
    expect(text).not.toContain('enqueueMessage');
    expect(text).not.toContain('TblMessageOutbox');
    expect(text).not.toContain('sendQuickWhatsAppMessage');
    expect(text).not.toContain('processOutboxTick');
    expect(text).not.toContain('messaging-outbox-worker');
  });

  it('leaves sendMessage as a direct Gateway send, not an outbox enqueue', () => {
    const text = src('src/modules/messaging/application/sendMessage.ts');
    expect(text).toContain('sendWhatsAppChannelMessage');
    expect(text).not.toContain('enqueueMessage');
    expect(text).not.toContain('TblMessageOutbox');
    expect(text).not.toContain('messageOutboxRepository');
  });

  it('does not change the WhatsApp Gateway adapter contract', () => {
    const adapter = src('src/modules/messaging/infra/whatsappAdapter.ts');
    expect(adapter).toContain('sendWhatsAppMessage');
    expect(adapter).not.toContain('enqueueMessage');
    expect(adapter).not.toContain('TblMessageOutbox');

    const gateway = src('src/lib/integrations/whatsapp/index.ts');
    expect(gateway).not.toContain('enqueueMessage');
    expect(gateway).not.toContain('TblMessageOutbox');
    const gatewayService = src('src/lib/integrations/whatsapp/service.ts');
    expect(gatewayService).not.toContain('enqueueMessage');
    expect(gatewayService).not.toContain('TblMessageOutbox');
  });
});
