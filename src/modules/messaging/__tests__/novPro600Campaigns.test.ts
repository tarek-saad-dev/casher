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
  cancelPendingRecipients: vi.fn(async () => 1),
  listRecipientsByCampaign: vi.fn(async () => []),
  countRecipientsByStatus: vi.fn(async () => ({
    pending: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  })),
}));

import {
  parseAudienceCriteria,
  serializeAudienceCriteria,
  NOV_PRO600_SEGMENTS,
} from '@/modules/messaging/campaigns/domain/types';
import { renderCustomCampaignMessage } from '@/modules/messaging/campaigns/application/renderCampaignMessage';
import { startCampaign } from '@/modules/messaging/campaigns/application/startCampaign';
import { pauseCampaign } from '@/modules/messaging/campaigns/application/pauseCampaign';
import { testSendCampaignMessage } from '@/modules/messaging/campaigns/application/testSendCampaignMessage';
import { WHATSAPP_CAMPAIGN_TEMPLATE_KEY } from '@/modules/messaging/templates/catalog';

function src(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8');
}

describe('NOV-PRO600 minimal WhatsApp campaigns', () => {
  beforeEach(() => {
    enqueueMessage.mockReset();
    getCampaignById.mockReset();
    insertCampaignRecipient.mockReset();
    getRecipientByIdempotencyKey.mockReset();
    updateCampaignStatus.mockReset();
    updateRecipient.mockReset();
    buildCampaignAudience.mockReset();
    composeMessage.mockReset();
    enqueueMessage.mockResolvedValue({
      queued: true,
      messageId: 9001,
      status: 'pending',
      duplicate: false,
    });
    delete process.env.WHATSAPP_CAMPAIGN_TEST_PHONES;
  });

  it('serializes nov_pro600 audience criteria', () => {
    const json = serializeAudienceCriteria({
      mode: 'nov_pro600',
      novPro600Segments: ['VIP', 'HAIRCUT_REGULAR'],
      asOfDate: '2026-11-01',
    });
    const parsed = parseAudienceCriteria(json);
    expect(parsed.mode).toBe('nov_pro600');
    expect(parsed.novPro600Segments).toEqual(['VIP', 'HAIRCUT_REGULAR']);
    expect(NOV_PRO600_SEGMENTS).toContain('HAIR_CARE');
  });

  it('renders first_name and branch_name personalization', () => {
    const rendered = renderCustomCampaignMessage(
      'أهلاً {{first_name}} من {{branch_name}}',
      { customerName: 'أحمد محمد', branchName: 'جليم – سابا باشا' },
    );
    expect(rendered).toBe('أهلاً أحمد من جليم – سابا باشا');
  });

  it('catalog includes whatsapp.campaign marketing template', () => {
    expect(WHATSAPP_CAMPAIGN_TEMPLATE_KEY).toBe('whatsapp.campaign');
    const catalog = src('src/modules/messaging/templates/catalog.ts');
    expect(catalog).toContain('WHATSAPP_CAMPAIGN_DEFAULT_TEMPLATE');
    expect(catalog).toContain('NOV-PRO600');
  });

  it('requires explicitApproval for nov_pro600 start', async () => {
    getCampaignById.mockResolvedValue({
      id: 11,
      status: 'draft',
      messageMode: 'template',
      templateKey: 'whatsapp.campaign',
      customMessage: null,
      audienceJson: JSON.stringify({ mode: 'nov_pro600', novPro600Segments: ['VIP'] }),
      branchId: 1,
    });

    await expect(startCampaign({ campaignId: 11, userId: 1 })).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    expect(buildCampaignAudience).not.toHaveBeenCalled();
  });

  it('requires template mode for nov_pro600 start', async () => {
    getCampaignById.mockResolvedValue({
      id: 12,
      status: 'draft',
      messageMode: 'custom',
      templateKey: null,
      customMessage: 'hi',
      audienceJson: JSON.stringify({ mode: 'nov_pro600' }),
      branchId: 1,
    });

    await expect(
      startCampaign({ campaignId: 12, userId: 1, explicitApproval: true }),
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
  });

  it('returns CONSENT_REQUIRED when no send-eligible members', async () => {
    getCampaignById.mockResolvedValue({
      id: 13,
      status: 'draft',
      messageMode: 'template',
      templateKey: 'whatsapp.campaign',
      customMessage: null,
      audienceJson: JSON.stringify({ mode: 'nov_pro600' }),
      branchId: 1,
    });
    buildCampaignAudience.mockResolvedValue([]);

    await expect(
      startCampaign({ campaignId: 13, userId: 1, explicitApproval: true }),
    ).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  });

  it('dedupes phones and enqueues eligible nov_pro600 recipients once', async () => {
    getCampaignById
      .mockResolvedValueOnce({
        id: 14,
        status: 'draft',
        messageMode: 'template',
        templateKey: 'whatsapp.campaign',
        customMessage: null,
        audienceJson: JSON.stringify({ mode: 'nov_pro600', novPro600Segments: ['VIP'] }),
        branchId: 1,
      })
      .mockResolvedValue({
        id: 14,
        status: 'running',
        pendingCount: 0,
        sentCount: 0,
        failedCount: 0,
        totalRecipients: 1,
      });

    buildCampaignAudience.mockResolvedValue([
      {
        clientId: 1,
        phone: '201012345678',
        name: 'أحمد',
        firstName: 'أحمد',
        branchName: 'جليم',
        visitCount: 5,
        totalSpend: 1000,
        lastVisitDate: null,
        segment: 'VIP',
        sendEligible: true,
        consentEvidence: 'import:sheet-1',
      },
      {
        clientId: 2,
        phone: '201012345678',
        name: 'مكرر',
        visitCount: 1,
        totalSpend: 0,
        lastVisitDate: null,
        segment: 'VIP',
        sendEligible: true,
        consentEvidence: 'import:sheet-1',
      },
    ]);

    getRecipientByIdempotencyKey.mockResolvedValue(null);
    insertCampaignRecipient.mockResolvedValue({
      id: 501,
      campaignId: 14,
      status: 'pending',
      idempotencyKey: 'campaign:14:recipient:1',
    });
    composeMessage.mockResolvedValue({ text: 'مرحباً أحمد', source: 'code_default' });

    const result = await startCampaign({
      campaignId: 14,
      userId: 9,
      explicitApproval: true,
    });

    expect(result.enqueued).toBe(1);
    expect(enqueueMessage).toHaveBeenCalledTimes(1);
    expect(enqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          source: 'whatsapp.campaign',
          campaignCode: 'NOV-PRO600',
          marketing: true,
          consentEvidence: 'import:sheet-1',
        }),
      }),
    );
  });

  it('pauseCampaign marks paused after cancelling pending', async () => {
    getCampaignById.mockResolvedValue({ id: 20, status: 'running' });
    updateCampaignStatus.mockResolvedValue({ id: 20, status: 'paused' });

    const result = await pauseCampaign(20);
    expect(updateCampaignStatus).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ status: 'paused' }),
    );
    expect(result?.status).toBe('paused');
  });

  it('testSend denies phones outside allowlist', async () => {
    process.env.WHATSAPP_CAMPAIGN_TEST_PHONES = '201555000000';
    await expect(
      testSendCampaignMessage({
        phone: '01099999999',
        messageMode: 'template',
        templateKey: 'whatsapp.campaign',
        userId: 1,
        branchId: 1,
      }),
    ).rejects.toMatchObject({ code: 'TEST_PHONE_DENIED' });
  });

  it('testSend enqueues when phone is allowlisted', async () => {
    process.env.WHATSAPP_CAMPAIGN_TEST_PHONES = '201555000000';
    composeMessage.mockResolvedValue({ text: 'اختبار', source: 'code_default' });

    const result = await testSendCampaignMessage({
      phone: '+20 155 500 0000',
      messageMode: 'template',
      templateKey: 'whatsapp.campaign',
      userId: 1,
      branchId: 1,
    });

    expect(result.messageId).toBe(9001);
    expect(enqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ source: 'whatsapp.campaign.test', testOnly: true }),
      }),
    );
  });

  it('does not introduce Baileys/web automation in campaign start', () => {
    const startSrc = src('src/modules/messaging/campaigns/application/startCampaign.ts');
    expect(startSrc).not.toMatch(/baileys|whatsapp-web\.js|puppeteer/i);
    expect(startSrc).toContain('enqueueMessage');
  });
});
