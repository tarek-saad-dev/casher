import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function src(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8');
}

describe('Phase 5A/5C1 does not change current send paths', () => {
  it('leaves POST /api/sales on sendSaleCustomerReceipt (not enqueueMessage)', () => {
    const route = src('src/app/api/sales/route.ts');
    const extracted = src('src/apps/pos/application/createSale.ts');
    const legacy = src('src/lib/sales/legacyRouteSaleCreate.ts');
    const text = src('src/apps/pos/internal/salePostCommitEffects.ts');

    expect(route).toContain('createSale(');
    expect(route).toContain('createSaleLegacyFromRoute');
    expect(extracted).toContain('runSalePostCommitEffects');
    expect(legacy).toContain('runSalePostCommitEffects');

    expect(text).toContain('sendSaleCustomerReceipt');
    expect(text).toContain("@/modules/messaging");
    expect(text).not.toContain('enqueueMessage');
    expect(text).not.toContain('TblMessageOutbox');
    expect(text).not.toContain('listMessageHistory');
    expect(text).not.toContain('processOutboxTick');
    expect(text).not.toContain('messaging-outbox-worker');

    for (const caller of [route, extracted, legacy]) {
      expect(caller).not.toContain('enqueueMessage');
      expect(caller).not.toContain('TblMessageOutbox');
      expect(caller).not.toContain('listMessageHistory');
      expect(caller).not.toContain('processOutboxTick');
      expect(caller).not.toContain('messaging-outbox-worker');
    }
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
    expect(adapter).toContain('sendViaTenantChannel');
    expect(adapter).toContain('tenancy/transport');
    expect(adapter).not.toContain('@/lib/integrations/whatsapp');
    expect(adapter).not.toContain('enqueueMessage');
    expect(adapter).not.toContain('TblMessageOutbox');

    const transport = src('src/modules/messaging/tenancy/transport.ts');
    expect(transport).toContain('sendWhatsAppMessage(input, { apiBaseUrl: channel.endpointUrl })');
    expect(transport).not.toContain('enqueueMessage');
    expect(transport).not.toContain('TblMessageOutbox');

    const gateway = src('src/lib/integrations/whatsapp/index.ts');
    expect(gateway).not.toContain('enqueueMessage');
    expect(gateway).not.toContain('TblMessageOutbox');
    const gatewayService = src('src/lib/integrations/whatsapp/service.ts');
    expect(gatewayService).not.toContain('enqueueMessage');
    expect(gatewayService).not.toContain('TblMessageOutbox');
  });
});
