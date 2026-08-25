import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const enqueueMessage = vi.fn();
const getCampaignById = vi.fn();
const insertCampaignRecipient = vi.fn();
const getRecipientByIdempotencyKey = vi.fn();
const updateCampaignStatus = vi.fn();
const updateRecipient = vi.fn();
const buildCampaignAudience = vi.fn();
const composeMessage = vi.fn();

vi.mock('@/modules/messaging/application/enqueueMessage', () => ({
  enqueueMessage: (...args: unknown[]) => enqueueMessage(...args),
}));

vi.mock('@/modules/messaging/application/composeMessage', () => ({
  composeMessage: (...args: unknown[]) => composeMessage(...args),
}));

vi.mock('@/modules/messaging/campaigns/audience/previewAudience', () => ({
  buildCampaignAudience: (...args: unknown[]) => buildCampaignAudience(...args),
  previewAudience: vi.fn(),
}));

vi.mock('@/modules/messaging/campaigns/infra/campaignRepository', () => ({
  getCampaignById: (...args: unknown[]) => getCampaignById(...args),
  insertCampaignRecipient: (...args: unknown[]) => insertCampaignRecipient(...args),
  getRecipientByIdempotencyKey: (...args: unknown[]) => getRecipientByIdempotencyKey(...args),
  updateCampaignStatus: (...args: unknown[]) => updateCampaignStatus(...args),
  updateRecipient: (...args: unknown[]) => updateRecipient(...args),
  cancelPendingRecipients: vi.fn(async () => 2),
  listRecipientsByCampaign: vi.fn(async () => []),
  countRecipientsByStatus: vi.fn(async () => ({
    pending: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    cancelled: 2,
    skipped: 0,
  })),
}));

import {
  buildRecipientIdempotencyKey,
  serializeAudienceCriteria,
  parseAudienceCriteria,
} from '@/modules/messaging/campaigns/domain/types';
import { renderCustomCampaignMessage } from '@/modules/messaging/campaigns/application/renderCampaignMessage';
import { startCampaign } from '@/modules/messaging/campaigns/application/startCampaign';
import { cancelCampaign } from '@/modules/messaging/campaigns/application/cancelCampaign';
import { EMPLOYEE_TIP_TEMPLATE_KEY } from '@/modules/messaging/templates/catalog';

function src(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8');
}

describe('Phase 7 WhatsApp campaigns', () => {
  beforeEach(() => {
    enqueueMessage.mockReset();
    getCampaignById.mockReset();
    insertCampaignRecipient.mockReset();
    getRecipientByIdempotencyKey.mockReset();
    updateCampaignStatus.mockReset();
    updateRecipient.mockReset();
    buildCampaignAudience.mockReset();
    composeMessage.mockReset();

    enqueueMessage.mockResolvedValue({ queued: true, messageId: 9001, status: 'pending', duplicate: false });
    composeMessage.mockResolvedValue({ text: 'مرحباً أحمد', source: 'code_default' });
  });

  it('serializes audience criteria as stable JSON', () => {
    const json = serializeAudienceCriteria({
      mode: 'rules',
      branchId: 3,
      rules: [{ city: 'القاهرة', minVisits: 2 }],
    });
    const parsed = parseAudienceCriteria(json);
    expect(parsed.mode).toBe('rules');
    expect(parsed.branchId).toBe(3);
    expect(parsed.rules?.[0]?.city).toBe('القاهرة');
  });

  it('builds idempotency key campaign:{id}:recipient:{customerId|phone}', () => {
    expect(buildRecipientIdempotencyKey(5, 42, '201012345678')).toBe('campaign:5:recipient:42');
    expect(buildRecipientIdempotencyKey(5, null, '201012345678')).toBe(
      'campaign:5:recipient:201012345678',
    );
  });

  it('renders custom message with {{customerName}}', () => {
    const rendered = renderCustomCampaignMessage('أهلاً {{customerName}}!', 'سارة');
    expect(rendered).toBe('أهلاً سارة!');
  });

  it('tip production path uses sendTemplateMessage + EMPLOYEE_TIP_TEMPLATE_KEY', () => {
    const notify = src('src/lib/services/employeeAdvanceWhatsAppNotify.ts');
    expect(notify).toContain('sendTemplateMessage');
    expect(notify).toContain('EMPLOYEE_TIP_TEMPLATE_KEY');
    expect(notify).toContain("templateKey: EMPLOYEE_TIP_TEMPLATE_KEY");
    expect(EMPLOYEE_TIP_TEMPLATE_KEY).toBe('employee.tip');

    const parity = src('src/lib/hr/tip-whatsapp-message.ts');
    expect(parity).toContain('composeEmployeeTipWhatsAppMessage');
  });

  it('startCampaign does not call bot campaign APIs', () => {
    const startSrc = src('src/modules/messaging/campaigns/application/startCampaign.ts');
    const indexSrc = src('src/modules/messaging/campaigns/index.ts');
    expect(startSrc).not.toMatch(/whatsapp-bot|campaigns\.js|offerAudienceBuilder/);
    expect(indexSrc).not.toMatch(/whatsapp-bot|\/api\/campaigns/);
    expect(startSrc).toContain('enqueueMessage');
  });

  it('enqueueMessage called with source whatsapp.campaign and no gateway type', async () => {
    getCampaignById
      .mockResolvedValueOnce({
        id: 7,
        status: 'draft',
        messageMode: 'custom',
        templateKey: null,
        customMessage: 'مرحباً {{customerName}}',
        audienceJson: JSON.stringify({ mode: 'all' }),
        branchId: 2,
      })
      .mockResolvedValue({
        id: 7,
        status: 'running',
        pendingCount: 0,
        sentCount: 0,
        failedCount: 0,
        totalRecipients: 1,
      });

    buildCampaignAudience.mockResolvedValue([
      { clientId: 10, phone: '01234567890', name: 'أحمد', visitCount: 1, totalSpend: 100, lastVisitDate: null },
    ]);

    getRecipientByIdempotencyKey.mockResolvedValue(null);
    insertCampaignRecipient.mockResolvedValue({
      id: 100,
      campaignId: 7,
      status: 'pending',
      idempotencyKey: 'campaign:7:recipient:10',
    });

    await startCampaign({ campaignId: 7, userId: 1 });

    expect(enqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        idempotencyKey: 'campaign:7:recipient:10',
        metadata: expect.objectContaining({
          source: 'whatsapp.campaign',
          campaignId: 7,
          customerId: 10,
        }),
      }),
    );

    const adapter = src('src/modules/messaging/infra/whatsappAdapter.ts');
    expect(adapter).not.toContain('type:');
  });

  it('cancel marks campaign cancelled via repository', async () => {
    getCampaignById.mockResolvedValue({ id: 3, status: 'running' });
    updateCampaignStatus.mockResolvedValue({ id: 3, status: 'cancelled' });

    const result = await cancelCampaign(3);
    expect(updateCampaignStatus).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(result?.status).toBe('cancelled');
  });

  it('duplicate enqueue keeps existing outbox id', async () => {
    getCampaignById
      .mockResolvedValueOnce({
        id: 8,
        status: 'draft',
        messageMode: 'template',
        templateKey: 'customer.first_time',
        customMessage: null,
        audienceJson: JSON.stringify({ mode: 'all' }),
        branchId: null,
      })
      .mockResolvedValue({
        id: 8,
        status: 'running',
        pendingCount: 0,
        sentCount: 0,
        failedCount: 0,
        totalRecipients: 1,
      });

    buildCampaignAudience.mockResolvedValue([
      { clientId: 11, phone: '01111111111', name: 'خالد', visitCount: 0, totalSpend: 0, lastVisitDate: null },
    ]);

    getRecipientByIdempotencyKey.mockResolvedValue({
      id: 200,
      campaignId: 8,
      status: 'queued',
      idempotencyKey: 'campaign:8:recipient:11',
      outboxMessageId: 555,
    });

    enqueueMessage.mockResolvedValueOnce({
      queued: true,
      messageId: 555,
      status: 'pending',
      duplicate: true,
    });

    await startCampaign({ campaignId: 8, userId: 2 });

    expect(enqueueMessage).toHaveBeenCalled();
    expect(insertCampaignRecipient).not.toHaveBeenCalled();
  });
});
