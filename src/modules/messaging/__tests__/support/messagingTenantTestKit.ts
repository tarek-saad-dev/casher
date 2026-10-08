import type {
  GenericWhatsAppGroupMessageInput,
  GenericWhatsAppMessageInput,
} from '@/lib/integrations/whatsapp';
import type { ActiveTenantMessagingChannel } from '../../tenancy/channelRepository';
import { runWithMessagingTenant } from '../../tenancy/messagingTenantScope';
import {
  setMessagingChannelResolverForTests,
  setMessagingTransportForTests,
  type MessagingTransport,
} from '../../tenancy/transport';
import { setMessagingUsageRecorderForTests, type MessagingUsageMetric } from '../../tenancy/usage';
import { setTenantAiConfigLoaderForTests, SALON_CONCIERGE_PACK, type TenantAiConfig } from '../../tenancy/tenantAiConfig';
import { setTenantLocationLoaderForTests, resetTenantBusinessScopeCaches } from '../../tenancy/tenantBusinessScope';
import { setBranchTenantResolverForTests } from '../../tenancy/branchTenantScope';

export const TENANT_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
export const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

export type TestLocation = { legacyBranchId: number; branchCode: string };

export type MessagingTenantFixture = {
  channels?: Record<string, { endpointUrl: string; channelId?: string } | null>;
  locations?: Record<string, TestLocation[]>;
  aiConfigs?: Record<string, Partial<TenantAiConfig> | null>;
  /** Fake transport; omit to keep the real bridge transport (tests that mock fetch). */
  transport?: MessagingTransport;
};

export type UsageEvent = { tenantId: string; metric: MessagingUsageMetric; count: number };

export const DEFAULT_TEST_ENDPOINT = 'http://bridge.test';

export function testChannel(tenantId: string, endpointUrl = DEFAULT_TEST_ENDPOINT): ActiveTenantMessagingChannel {
  return {
    channelId: `channel-${tenantId.slice(0, 8)}`,
    tenantId,
    channel: 'whatsapp',
    provider: 'whatsapp-bridge',
    endpointUrl,
    sessionId: null,
    phoneNumber: null,
    status: 'active',
  };
}

export function testAiConfig(tenantId: string, overrides: Partial<TenantAiConfig> = {}): TenantAiConfig {
  return {
    tenantId,
    enabled: true,
    industryCode: 'salon',
    businessName: 'Test Business',
    assistantPersona: 'صالون حلاقة مصري',
    locale: 'ar-EG',
    websiteUrl: null,
    bookingUrl: null,
    pricesUrl: null,
    locationHours: [],
    policies: [],
    bookingActorUserId: 1,
    conversationPack: SALON_CONCIERGE_PACK,
    revision: 1,
    ...overrides,
  };
}

/**
 * Installs every messaging tenancy seam with in-memory fakes. Defaults model CUT as TENANT_A:
 * channel at DEFAULT_TEST_ENDPOINT, branches 1/2 (GLEEM, CAMP_CAESAR), salon pack AI config,
 * legacy client directory owner. Returns recorded usage events.
 */
export function installMessagingTenantTestKit(fixture: MessagingTenantFixture = {}): {
  usage: UsageEvent[];
} {
  const channels = fixture.channels ?? { [TENANT_A]: { endpointUrl: DEFAULT_TEST_ENDPOINT } };
  const locations = fixture.locations ?? {
    [TENANT_A]: [
      { legacyBranchId: 1, branchCode: 'GLEEM' },
      { legacyBranchId: 2, branchCode: 'CAMP_CAESAR' },
    ],
  };
  const aiConfigs = fixture.aiConfigs ?? { [TENANT_A]: {} };
  const usage: UsageEvent[] = [];

  setMessagingChannelResolverForTests(async (tenantId) => {
    const c = channels[tenantId];
    return c ? { ...testChannel(tenantId, c.endpointUrl), ...(c.channelId ? { channelId: c.channelId } : {}) } : null;
  });
  setMessagingTransportForTests(fixture.transport ?? null);
  setMessagingUsageRecorderForTests(async (e) => {
    usage.push({ tenantId: e.tenantId, metric: e.metric, count: e.count });
  });
  setTenantLocationLoaderForTests(async (tenantId) => locations[tenantId] ?? []);
  setTenantAiConfigLoaderForTests(async (tenantId) => {
    const c = aiConfigs[tenantId];
    return c === undefined || c === null ? null : testAiConfig(tenantId, c);
  });
  setBranchTenantResolverForTests(async (branchId) => {
    const owners = Object.entries(locations)
      .filter(([, locs]) => locs.some((l) => l.legacyBranchId === branchId))
      .map(([tenantId]) => tenantId);
    return owners.length === 1 ? owners[0] : null;
  });
  return { usage };
}

export function resetMessagingTenantTestKit(): void {
  setMessagingChannelResolverForTests(null);
  setMessagingTransportForTests(null);
  setMessagingUsageRecorderForTests(null);
  setTenantLocationLoaderForTests(null);
  setTenantAiConfigLoaderForTests(null);
  setBranchTenantResolverForTests(null);
  resetTenantBusinessScopeCaches();
}

/** Runs `fn` as a worker/job of `tenantId` (the scope workers establish per claimed row). */
export function inTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithMessagingTenant({ tenantId, source: 'job', detail: 'test' }, fn);
}

/** Recording fake transport: every send is captured with the channel it went through. */
export function recordingTransport(): MessagingTransport & {
  sends: Array<{ channelId: string; tenantId: string; endpointUrl: string; input: GenericWhatsAppMessageInput }>;
  groupSends: Array<{ channelId: string; tenantId: string; input: GenericWhatsAppGroupMessageInput }>;
} {
  const sends: Array<{ channelId: string; tenantId: string; endpointUrl: string; input: GenericWhatsAppMessageInput }> = [];
  const groupSends: Array<{ channelId: string; tenantId: string; input: GenericWhatsAppGroupMessageInput }> = [];
  let n = 0;
  return {
    sends,
    groupSends,
    async send(channel, input) {
      sends.push({ channelId: channel.channelId, tenantId: channel.tenantId, endpointUrl: channel.endpointUrl, input });
      n += 1;
      return { sent: true, skipped: false, status: 'sent', messageId: `wa-${channel.tenantId.slice(0, 1)}-${n}` };
    },
    async sendGroup(channel, input) {
      groupSends.push({ channelId: channel.channelId, tenantId: channel.tenantId, input });
      return { sent: true, skipped: false, status: 'sent', messageId: `wa-group-${groupSends.length}` };
    },
    async status() {
      return { available: true, chromeConnected: true, whatsappReady: true, whatsappTabFound: true, connected: true };
    },
    async health() {
      return { ok: true, httpStatus: 200 };
    },
  };
}
