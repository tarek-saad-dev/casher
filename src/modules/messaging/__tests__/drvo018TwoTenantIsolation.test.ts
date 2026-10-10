/**
 * DRVO-018 two-tenant smoke (fake transport, no DB): inbound, outbound, workers, AI profile and
 * usage stay inside the owning tenant. TENANT_A plays CUT (salon pack); TENANT_B is a clinic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { OutboxMessageRow } from '../domain/outboxTypes';

const outboxRows: OutboxMessageRow[] = [];
const settled: Array<{ op: string; id: number; scopeTenant: string | null }> = [];

vi.mock('../outbox/messageOutboxRepository', async () => {
  const { currentMessagingTenantScope } = await import('../tenancy/messagingTenantScope');
  const scopeTenant = () => currentMessagingTenantScope()?.tenantId ?? null;
  return {
    recoverStaleSending: vi.fn(async () => []),
    claimPendingBatch: vi.fn(async () => outboxRows.splice(0)),
    markSent: vi.fn(async ({ id }: { id: number }) => {
      settled.push({ op: 'sent', id, scopeTenant: scopeTenant() });
    }),
    markFailed: vi.fn(async ({ id }: { id: number }) => {
      settled.push({ op: 'failed', id, scopeTenant: scopeTenant() });
    }),
    scheduleRetry: vi.fn(async ({ id }: { id: number }) => {
      settled.push({ op: 'retry', id, scopeTenant: scopeTenant() });
    }),
  };
});

vi.mock('@/modules/messaging/handoff/application/outboxSendGate', () => ({
  evaluateOutboxSendGate: vi.fn(async () => ({ allow: true })),
  stampOutboxCorrelationAfterSend: vi.fn(async () => undefined),
}));

const clientDirectoryCalls: string[] = [];
vi.mock('@/lib/client/clientPhoneLookup', () => ({
  lookupClientIdByPhone: vi.fn(async (tenantId: string, phone: string) => {
    clientDirectoryCalls.push(tenantId);
    const byTenant: Record<string, number> = {
      'aaaaaaaa-0000-4000-8000-00000000000a': 101,
      'bbbbbbbb-0000-4000-8000-00000000000b': 202,
    };
    const clientId = phone.endsWith('12345678') ? byTenant[tenantId.toLowerCase()] ?? null : null;
    return { clientId, ambiguous: false, matchCount: clientId ? 1 : 0 };
  }),
}));

vi.mock('@/lib/booking/publicBookingBranchContext', () => ({
  listPublicDiscoverableBranches: vi.fn(async () => [
    { branchId: 1, branchCode: 'GLEEM', branchName: 'Gleem', shortName: null, address: null, phone: null, timeZone: 'Africa/Cairo' },
    { branchId: 2, branchCode: 'CAMP_CAESAR', branchName: 'Camp', shortName: null, address: null, phone: null, timeZone: 'Africa/Cairo' },
    { branchId: 7, branchCode: 'CLINIC_MAIN', branchName: 'Clinic', shortName: null, address: null, phone: null, timeZone: 'Africa/Cairo' },
  ]),
}));

import {
  TENANT_A,
  TENANT_B,
  inTenant,
  installMessagingTenantTestKit,
  recordingTransport,
  resetMessagingTenantTestKit,
} from './support/messagingTenantTestKit';
import { sendViaTenantChannel, sendGroupViaTenantChannel } from '../tenancy/transport';
import { processOutboxTick } from '../application/processOutboxTick';
import {
  isWhatsAppInboxWebhookAuthResult,
  recordInboundMessageUsage,
  requireWhatsAppInboxWebhookAuth,
  runWithWebhookMessagingTenant,
} from '../inbox/auth';
import { hashChannelWebhookToken } from '../tenancy/channelToken';
import { currentMessagingTenantScope, runWithMessagingJobTenant } from '../tenancy/messagingTenantScope';
import { getCurrentTenantAiConfig, usesSalonConciergePack } from '../tenancy/tenantAiConfig';
import { buildAiSystemInstructions } from '../ai/domain/systemInstructions';
import { listTenantDiscoverableBranches } from '../ai/tenantBookingDirectory';
import { executeAiBusinessTool } from '../ai/tools/registry';
import { lookupTenantClientIdByPhone } from '../contacts/tenantClientDirectory';
import { runWithMessagingTenantForBranch } from '../tenancy/branchTenantScope';
import { testChannel } from './support/messagingTenantTestKit';

const TOKEN_A = 'token-for-tenant-a-0000000000000000';
const TOKEN_B = 'token-for-tenant-b-0000000000000000';

let transport: ReturnType<typeof recordingTransport>;
let usage: ReturnType<typeof installMessagingTenantTestKit>['usage'];

function outboxRow(id: number, tenantId: string | null): OutboxMessageRow {
  return {
    id,
    tenantId,
    channel: 'whatsapp',
    recipient: `0100000000${id}`,
    templateKey: null,
    content: `message ${id}`,
    metadataJson: null,
    idempotencyKey: `idem-${id}`,
    status: 'sending',
    attemptCount: 1,
    maxAttempts: 5,
    nextAttemptAt: null,
    lockedAt: null,
    lockedBy: 'w',
    providerMessageId: null,
    lastError: null,
    branchId: null,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    sentAt: null,
    failedAt: null,
  };
}

function webhookRequest(token: string | null): NextRequest {
  return new NextRequest('http://localhost/api/internal/messaging/inbox/whatsapp', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

const channelByHash = async (hash: string) => {
  if (hash === hashChannelWebhookToken(TOKEN_A)) return testChannel(TENANT_A, 'http://bridge-a.test');
  if (hash === hashChannelWebhookToken(TOKEN_B)) return testChannel(TENANT_B, 'http://bridge-b.test');
  return null;
};

beforeEach(() => {
  outboxRows.length = 0;
  settled.length = 0;
  transport = recordingTransport();
  ({ usage } = installMessagingTenantTestKit({
    transport,
    channels: {
      [TENANT_A]: { endpointUrl: 'http://bridge-a.test' },
      [TENANT_B]: { endpointUrl: 'http://bridge-b.test' },
    },
    locations: {
      [TENANT_A]: [
        { legacyBranchId: 1, branchCode: 'GLEEM' },
        { legacyBranchId: 2, branchCode: 'CAMP_CAESAR' },
      ],
      [TENANT_B]: [{ legacyBranchId: 7, branchCode: 'CLINIC_MAIN' }],
    },
    aiConfigs: {
      [TENANT_A]: {},
      [TENANT_B]: {
        industryCode: 'clinic',
        businessName: 'Nile Dental',
        assistantPersona: 'عيادة أسنان',
        policies: ['الكشف بالحجز المسبق فقط'],
        conversationPack: null,
        bookingActorUserId: null,
      },
    },
  }));
});

afterEach(() => {
  resetMessagingTenantTestKit();
});

describe('DRVO-018 inbound webhook isolation', () => {
  it('derives the tenant from the channel token and never crosses to the other tenant', async () => {
    const authA = await requireWhatsAppInboxWebhookAuth(webhookRequest(TOKEN_A), { findChannel: channelByHash });
    const authB = await requireWhatsAppInboxWebhookAuth(webhookRequest(TOKEN_B), { findChannel: channelByHash });
    expect(isWhatsAppInboxWebhookAuthResult(authA) && authA.tenantId).toBe(TENANT_A);
    expect(isWhatsAppInboxWebhookAuthResult(authB) && authB.tenantId).toBe(TENANT_B);

    if (!isWhatsAppInboxWebhookAuthResult(authA)) throw new Error('auth A failed');
    const seen = await runWithWebhookMessagingTenant(authA, 'test', async () => {
      await recordInboundMessageUsage();
      return currentMessagingTenantScope()?.tenantId;
    });
    expect(seen).toBe(TENANT_A);
    expect(usage).toEqual([{ tenantId: TENANT_A, metric: 'inbound_message', count: 1 }]);
  });

  it('fails closed for unknown or missing tokens (no shared fallback)', async () => {
    for (const token of ['unknown-token-zzzzzzzzzzzzzzzz', null]) {
      const res = await requireWhatsAppInboxWebhookAuth(webhookRequest(token), { findChannel: channelByHash });
      expect(isWhatsAppInboxWebhookAuthResult(res)).toBe(false);
      expect((res as Response).status).toBe(401);
    }
  });
});

describe('DRVO-018 outbound channel isolation', () => {
  it('sends each tenant through its own channel endpoint', async () => {
    await inTenant(TENANT_A, () => sendViaTenantChannel({ phone: '01000000001', message: 'a' }));
    await inTenant(TENANT_B, () => sendViaTenantChannel({ phone: '01000000002', message: 'b' }));
    await inTenant(TENANT_B, () => sendGroupViaTenantChannel({ groupInviteLink: 'https://chat.whatsapp.com/x', message: 'g' } as never));
    expect(transport.sends.map((s) => [s.tenantId, s.endpointUrl, s.input.message])).toEqual([
      [TENANT_A, 'http://bridge-a.test', 'a'],
      [TENANT_B, 'http://bridge-b.test', 'b'],
    ]);
    expect(transport.groupSends.map((s) => s.tenantId)).toEqual([TENANT_B]);
  });

  it('a tenant without a channel is skipped, never routed through another tenant', async () => {
    const TENANT_C = 'cccccccc-0000-4000-8000-00000000000c';
    const result = await inTenant(TENANT_C, () => sendViaTenantChannel({ phone: '01000000003', message: 'c' }));
    expect(result).toMatchObject({ sent: false, skipped: true, reason: 'channel_not_configured' });
    expect(transport.sends).toHaveLength(0);
  });

  it('sending without a tenant scope throws (no default tenant)', async () => {
    await expect(sendViaTenantChannel({ phone: '01000000004', message: 'x' })).rejects.toThrow();
    expect(transport.sends).toHaveLength(0);
  });
});

describe('DRVO-018 worker isolation', () => {
  it('delivers and settles each claimed row inside its own tenant and channel', async () => {
    outboxRows.push(outboxRow(1, TENANT_A), outboxRow(2, TENANT_B), outboxRow(3, null), outboxRow(4, TENANT_A));
    const summary = await processOutboxTick({ workerId: 'w', batchSize: 10, lockTtlMs: 60_000 });

    expect(summary).toMatchObject({ claimed: 4, sent: 3 });
    expect(transport.sends.map((s) => [s.input.idempotencyKey, s.tenantId, s.endpointUrl])).toEqual([
      ['idem-1', TENANT_A, 'http://bridge-a.test'],
      ['idem-2', TENANT_B, 'http://bridge-b.test'],
      ['idem-4', TENANT_A, 'http://bridge-a.test'],
    ]);
    expect(settled).toEqual([
      { op: 'sent', id: 1, scopeTenant: TENANT_A },
      { op: 'sent', id: 2, scopeTenant: TENANT_B },
      { op: 'sent', id: 4, scopeTenant: TENANT_A },
    ]);
  });

  it('an unbound tenant channel is retried by the outbox, not failed', async () => {
    const TENANT_C = 'cccccccc-0000-4000-8000-00000000000c';
    outboxRows.push(outboxRow(9, TENANT_C));
    const summary = await processOutboxTick({ workerId: 'w', batchSize: 10, lockTtlMs: 60_000 });
    expect(summary).toMatchObject({ claimed: 1, sent: 0, retried: 1, failed: 0 });
    expect(settled).toEqual([{ op: 'retry', id: 9, scopeTenant: TENANT_C }]);
    expect(transport.sends).toHaveLength(0);
  });

  it('a job context requires the row tenant', async () => {
    expect(() => runWithMessagingJobTenant(null, 'test', async () => 1)).toThrow(/TENANT|المنشأة/);
  });

  it('branch-derived scope picks the branch owner and rejects foreign branches inside a scope', async () => {
    const owner = await runWithMessagingTenantForBranch(7, 'test', async () => currentMessagingTenantScope()?.tenantId);
    expect(owner).toBe(TENANT_B);
    await expect(
      inTenant(TENANT_A, () => runWithMessagingTenantForBranch(7, 'test', async () => 'leak')),
    ).rejects.toThrow();
  });
});

describe('DRVO-018 AI isolation', () => {
  it('each tenant gets its own AI profile, persona, policies and pack', async () => {
    const [a, b] = await Promise.all([
      inTenant(TENANT_A, getCurrentTenantAiConfig),
      inTenant(TENANT_B, getCurrentTenantAiConfig),
    ]);
    expect(usesSalonConciergePack(a)).toBe(true);
    expect(usesSalonConciergePack(b)).toBe(false);

    const textB = buildAiSystemInstructions({ assistantPersona: b!.assistantPersona, policies: b!.policies, packHints: [] });
    expect(textB).toContain('أنت مساعد واتساب لعيادة أسنان.');
    expect(textB).toContain('- الكشف بالحجز المسبق فقط');
    expect(textB).not.toMatch(/صالون|حلاقة|شعر و دقن|cutsaloon/);
  });

  it('AI branch reads only see the current tenant locations', async () => {
    const aBranches = await inTenant(TENANT_A, listTenantDiscoverableBranches);
    const bBranches = await inTenant(TENANT_B, listTenantDiscoverableBranches);
    expect(aBranches.map((b) => b.branchCode)).toEqual(['GLEEM', 'CAMP_CAESAR']);
    expect(bBranches.map((b) => b.branchCode)).toEqual(['CLINIC_MAIN']);
  });

  it('tools reject a branch of another tenant', async () => {
    const result = await inTenant(TENANT_B, () =>
      executeAiBusinessTool({ name: 'list_services', branchCode: 'GLEEM' } as never, { phone: '010' } as never),
    );
    expect(result).toMatchObject({ ok: false, errorCode: 'BRANCH_NOT_IN_TENANT' });
  });

  it('customer lookup runs in the messaging tenant through the DRVO-015 tenant-scoped directory', async () => {
    clientDirectoryCalls.length = 0;
    const phone = '01012345678';
    expect((await inTenant(TENANT_A, () => lookupTenantClientIdByPhone(phone))).clientId).toBe(101);
    expect((await inTenant(TENANT_B, () => lookupTenantClientIdByPhone(phone))).clientId).toBe(202);
    expect(
      (await inTenant('cccccccc-0000-4000-8000-00000000000c', () => lookupTenantClientIdByPhone(phone))).clientId,
    ).toBeNull();
    expect(clientDirectoryCalls.map((t) => t.toLowerCase())).toEqual([
      TENANT_A,
      TENANT_B,
      'cccccccc-0000-4000-8000-00000000000c',
    ]);
    await expect(lookupTenantClientIdByPhone(phone)).rejects.toThrow();
  });
});

describe('DRVO-018 usage isolation', () => {
  it('counts usage per tenant', async () => {
    await inTenant(TENANT_A, () => sendViaTenantChannel({ phone: '01000000001', message: 'a1' }));
    await inTenant(TENANT_A, () => sendViaTenantChannel({ phone: '01000000001', message: 'a2' }));
    await inTenant(TENANT_B, () => sendViaTenantChannel({ phone: '01000000002', message: 'b1' }));
    const byTenant = (t: string) => usage.filter((u) => u.tenantId === t && u.metric === 'outbound_sent').length;
    expect(byTenant(TENANT_A)).toBe(2);
    expect(byTenant(TENANT_B)).toBe(1);
  });
});
