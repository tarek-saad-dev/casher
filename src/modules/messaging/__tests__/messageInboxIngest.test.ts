import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantContextError } from '@/platform/tenant/tenantContext';
import { runWithMessagingTenant } from '@/modules/messaging/tenancy/messagingTenantScope';
import { TENANT_A, TENANT_B } from './support/messagingTenantTestKit';

type RawRow = {
  ID: number;
  TenantId: string;
  Provider: string;
  ProviderMessageID: string;
  Phone: string;
  ChatTitle: string | null;
  MessageType: string;
  Text: string | null;
  IsGroup: boolean;
  RawPayload: string | null;
  Status: string;
  RetryCount: number;
  LastError: string | null;
  ReceivedAt: Date;
  ProcessingStartedAt: Date | null;
  ProcessedAt: Date | null;
  CreatedAt: Date;
  UpdatedAt: Date | null;
};

const db = vi.hoisted(() => {
  const byId = new Map<number, RawRow>();
  const byProviderMessage = new Map<string, RawRow>();
  const queries: Array<{ text: string; params: Record<string, unknown> }> = [];
  let nextId = 1;

  function providerKey(tenantId: string, provider: string, providerMessageId: string): string {
    return `${tenantId}\0${provider}\0${providerMessageId}`;
  }

  function requireTenant(params: Record<string, unknown>): string {
    if (typeof params.tenantId !== 'string' || !params.tenantId) {
      throw new Error('fake SQL: statement is missing @tenantId');
    }
    return params.tenantId;
  }

  function reset() {
    byId.clear();
    byProviderMessage.clear();
    queries.length = 0;
    nextId = 1;
  }

  async function insert(params: Record<string, unknown>): Promise<{ recordset: RawRow[] }> {
    const tenantId = requireTenant(params);
    const provider = String(params.provider);
    const providerMessageId = String(params.providerMessageId);
    const key = providerKey(tenantId, provider, providerMessageId);
    const violation = () =>
      Object.assign(
        new Error("Violation of UNIQUE KEY constraint 'UX_TblMessageInbox_Tenant_ProviderMessage'."),
        { number: 2627 },
      );
    await Promise.resolve();
    if (byProviderMessage.has(key)) throw violation();
    await new Promise((resolve) => setTimeout(resolve, 15));
    if (byProviderMessage.has(key)) throw violation();
    const now = new Date();
    const row: RawRow = {
      ID: nextId++,
      TenantId: tenantId,
      Provider: provider,
      ProviderMessageID: providerMessageId,
      Phone: String(params.phone),
      ChatTitle: (params.chatTitle as string | null) ?? null,
      MessageType: String(params.messageType),
      Text: (params.text as string | null) ?? null,
      IsGroup: Boolean(params.isGroup),
      RawPayload: (params.rawPayload as string | null) ?? null,
      Status: String(params.status ?? 'pending'),
      RetryCount: 0,
      LastError: null,
      ReceivedAt: params.receivedAt instanceof Date ? params.receivedAt : new Date(String(params.receivedAt)),
      ProcessingStartedAt: null,
      ProcessedAt: null,
      CreatedAt: now,
      UpdatedAt: null,
    };
    byProviderMessage.set(key, row);
    byId.set(row.ID, row);
    return { recordset: [{ ...row }] };
  }

  function list(params: Record<string, unknown>): { recordset: RawRow[] } {
    const tenantId = requireTenant(params);
    const fetchLimit = Number(params.fetchLimit ?? 50);
    const rows = [...byId.values()].filter((row) => {
      if (row.TenantId !== tenantId) return false;
      if (params.status != null && row.Status !== params.status) return false;
      return true;
    });
    rows.sort((a, b) => {
      const byReceived = b.ReceivedAt.getTime() - a.ReceivedAt.getTime();
      return byReceived !== 0 ? byReceived : b.ID - a.ID;
    });
    return { recordset: rows.slice(0, fetchLimit).map((row) => ({ ...row })) };
  }

  function request() {
    const params: Record<string, unknown> = {};
    const clear = () => Object.keys(params).forEach((key) => delete params[key]);
    return {
      input(name: string, _type: unknown, value: unknown) {
        params[name] = value;
        return this;
      },
      async query(text: string) {
        queries.push({ text, params: { ...params } });
        try {
          if (/INSERT INTO \[dbo\]\.\[TblMessageInbox\]/i.test(text)) {
            return await insert({ ...params });
          }
          if (/WHERE \[Provider\] = @provider\s+AND \[ProviderMessageID\] = @providerMessageId/i.test(text)) {
            const key = providerKey(
              requireTenant(params),
              String(params.provider),
              String(params.providerMessageId),
            );
            if (/SELECT COUNT\(\*\)/i.test(text)) {
              return { recordset: [{ cnt: byProviderMessage.has(key) ? 1 : 0 }] };
            }
            const row = byProviderMessage.get(key);
            return { recordset: row ? [{ ...row }] : [] };
          }
          if (/ORDER BY \[ReceivedAt\] DESC,\s*\[ID\] DESC/i.test(text)) {
            return list(params);
          }
          throw new Error(`Unexpected SQL in test fake: ${text.slice(0, 120)}`);
        } finally {
          clear();
        }
      },
    };
  }

  return { reset, request, byId, byProviderMessage, queries };
});

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({ request: () => db.request() })),
  sql: {
    MAX: 65535,
    Int: {},
    BigInt: {},
    DateTime2: {},
    Bit: {},
    UniqueIdentifier: {},
    NVarChar: () => ({}),
  },
}));

import { ingestIncomingMessage } from '@/modules/messaging/inbox/application/ingestIncomingMessage';
import {
  countByProviderMessage,
  getByProviderMessage,
  insert,
  list,
} from '@/modules/messaging/inbox/infra/messageInboxRepository';

const BASE_INPUT = {
  provider: 'whatsapp-web',
  providerMessageId: 'phase1-test-001',
  phone: '201234567890',
  chatTitle: 'Ahmed',
  messageType: 'text',
  text: 'عايز احجز بكرة',
  isGroup: false,
  receivedAt: '2026-08-28T07:00:00.000Z',
  rawPayload: { adapter: 'whatsapp-web' },
};

/** Inbound ingest runs in the tenant derived from the authenticated webhook channel. */
function asWebhook<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithMessagingTenant({ tenantId, source: 'webhook', detail: 'test-channel' }, fn);
}
const inA = <T>(fn: () => Promise<T>) => asWebhook(TENANT_A, fn);
const inB = <T>(fn: () => Promise<T>) => asWebhook(TENANT_B, fn);

describe('message inbox Phase 1 ingestion', () => {
  beforeEach(() => {
    db.reset();
  });

  it('Test A — first message creates one pending row with duplicate=false', async () => {
    const result = await inA(() => ingestIncomingMessage(BASE_INPUT));
    expect(result.duplicate).toBe(false);
    expect(result.inboxId).toBeGreaterThan(0);

    const row = await inA(() => getByProviderMessage('whatsapp-web', 'phase1-test-001'));
    expect(row?.status).toBe('pending');
    expect(row?.text).toBe('عايز احجز بكرة');
    expect(row?.tenantId).toBe(TENANT_A);
    expect(db.byId.size).toBe(1);
  });

  it('Test B — exact duplicate returns same inbox id without a second row', async () => {
    const first = await inA(() => ingestIncomingMessage(BASE_INPUT));
    const second = await inA(() => ingestIncomingMessage(BASE_INPUT));

    expect(second.duplicate).toBe(true);
    expect(second.inboxId).toBe(first.inboxId);
    expect(db.byId.size).toBe(1);
    expect(await inA(() => countByProviderMessage('whatsapp-web', 'phase1-test-001'))).toBe(1);
  });

  it('Test C — same text with different provider message ids creates two rows', async () => {
    const first = await inA(() => ingestIncomingMessage(BASE_INPUT));
    const second = await inA(() =>
      ingestIncomingMessage({
        ...BASE_INPUT,
        providerMessageId: 'phase1-test-002',
        text: 'تمام',
      }),
    );
    const third = await inA(() =>
      ingestIncomingMessage({
        ...BASE_INPUT,
        providerMessageId: 'phase1-test-003',
        text: 'تمام',
      }),
    );

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(false);
    expect(third.duplicate).toBe(false);
    expect(new Set([first.inboxId, second.inboxId, third.inboxId]).size).toBe(3);
    expect(db.byId.size).toBe(3);
  });

  it('Test D — concurrent duplicate ingestion creates exactly one row', async () => {
    const [a, b] = await Promise.all([
      inA(() => ingestIncomingMessage(BASE_INPUT)),
      inA(() => ingestIncomingMessage(BASE_INPUT)),
    ]);
    expect(a.inboxId).toBe(b.inboxId);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(db.byId.size).toBe(1);
  });

  it('Test E — Arabic text round-trips correctly', async () => {
    const arabic = 'مرحبا، أريد حجز موعد غداً الساعة ٣';
    const result = await inA(() =>
      ingestIncomingMessage({
        ...BASE_INPUT,
        providerMessageId: 'phase1-test-arabic',
        text: arabic,
      }),
    );
    const row = await inA(() => getByProviderMessage('whatsapp-web', 'phase1-test-arabic'));
    expect(result.duplicate).toBe(false);
    expect(row?.text).toBe(arabic);
  });

  it('Test F — missing provider message id is rejected', async () => {
    await expect(
      inA(() =>
        ingestIncomingMessage({
          ...BASE_INPUT,
          providerMessageId: '',
        }),
      ),
    ).rejects.toMatchObject({ code: 'MISSING_PROVIDER_MESSAGE_ID' });
    expect(db.byId.size).toBe(0);
  });

  it('stores group messages as ignored without processing', async () => {
    const result = await inA(() =>
      ingestIncomingMessage({
        ...BASE_INPUT,
        providerMessageId: 'phase1-test-group',
        isGroup: true,
      }),
    );
    const row = await inA(() => getByProviderMessage('whatsapp-web', 'phase1-test-group'));
    expect(result.duplicate).toBe(false);
    expect(row?.status).toBe('ignored');
    expect(row?.isGroup).toBe(true);
  });

  it('repository insert returns duplicate on unique constraint race', async () => {
    const record = {
      provider: 'whatsapp-web',
      providerMessageId: 'repo-dup-001',
      phone: '201111111111',
      chatTitle: null,
      messageType: 'text',
      text: 'hello',
      isGroup: false,
      rawPayloadJson: null,
      status: 'pending' as const,
      receivedAt: new Date('2026-08-28T07:00:00.000Z'),
    };
    const first = await inA(() => insert(record));
    const second = await inA(() => insert(record));
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.row.id).toBe(first.row.id);
  });

  it('rejects ingest without a tenant scope and writes nothing', async () => {
    await expect(ingestIncomingMessage(BASE_INPUT)).rejects.toBeInstanceOf(TenantContextError);
    await expect(getByProviderMessage('whatsapp-web', 'phase1-test-001')).rejects.toBeInstanceOf(
      TenantContextError,
    );
    expect(db.byId.size).toBe(0);
    expect(db.queries).toHaveLength(0);
  });

  it('stamps and filters TenantId via @tenantId on every statement', async () => {
    await inA(() => ingestIncomingMessage(BASE_INPUT));
    await inA(() => getByProviderMessage('whatsapp-web', 'phase1-test-001'));
    await inA(() => countByProviderMessage('whatsapp-web', 'phase1-test-001'));
    await inA(() => list({ fetchLimit: 10 }));

    expect(db.queries).toHaveLength(4);
    for (const q of db.queries) {
      expect(q.params.tenantId).toBe(TENANT_A);
      expect(q.text).toMatch(/@tenantId/);
    }
  });

  it('isolates tenants: same provider message id per tenant, no cross-tenant reads', async () => {
    const a = await inA(() => ingestIncomingMessage(BASE_INPUT));
    const b = await inB(() => ingestIncomingMessage(BASE_INPUT));

    expect(b.duplicate).toBe(false);
    expect(b.inboxId).not.toBe(a.inboxId);
    expect(db.byId.get(b.inboxId)?.TenantId).toBe(TENANT_B);

    expect((await inB(() => getByProviderMessage('whatsapp-web', 'phase1-test-001')))?.id).toBe(b.inboxId);
    expect((await inB(() => list({ fetchLimit: 10 }))).map((r) => r.id)).toEqual([b.inboxId]);
    expect((await inA(() => list({ fetchLimit: 10 }))).map((r) => r.id)).toEqual([a.inboxId]);
  });
});
