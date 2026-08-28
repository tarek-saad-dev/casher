import { describe, it, expect, vi, beforeEach } from 'vitest';

type RawRow = {
  ID: number;
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
  let nextId = 1;

  function providerKey(provider: string, providerMessageId: string): string {
    return `${provider}\0${providerMessageId}`;
  }

  function reset() {
    byId.clear();
    byProviderMessage.clear();
    nextId = 1;
  }

  async function insert(params: Record<string, unknown>): Promise<{ recordset: RawRow[] }> {
    const provider = String(params.provider);
    const providerMessageId = String(params.providerMessageId);
    const key = providerKey(provider, providerMessageId);
    await Promise.resolve();
    if (byProviderMessage.has(key)) {
      throw Object.assign(
        new Error("Violation of UNIQUE KEY constraint 'UQ_TblMessageInbox_ProviderMessage'."),
        { number: 2627 },
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
    if (byProviderMessage.has(key)) {
      throw Object.assign(
        new Error("Violation of UNIQUE KEY constraint 'UQ_TblMessageInbox_ProviderMessage'."),
        { number: 2627 },
      );
    }
    const now = new Date();
    const row: RawRow = {
      ID: nextId++,
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
    const fetchLimit = Number(params.fetchLimit ?? 50);
    const rows = [...byId.values()].filter((row) => {
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
    return {
      input(name: string, _type: unknown, value: unknown) {
        params[name] = value;
        return this;
      },
      async query(text: string) {
        if (/INSERT INTO \[dbo\]\.\[TblMessageInbox\]/i.test(text)) {
          const result = await insert({ ...params });
          Object.keys(params).forEach((key) => delete params[key]);
          return result;
        }
        if (
          /WHERE \[Provider\] = @provider\s+AND \[ProviderMessageID\] = @providerMessageId/i.test(text) &&
          /SELECT COUNT\(\*\)/i.test(text)
        ) {
          const key = providerKey(String(params.provider), String(params.providerMessageId));
          const cnt = byProviderMessage.has(key) ? 1 : 0;
          Object.keys(params).forEach((keyName) => delete params[keyName]);
          return { recordset: [{ cnt }] };
        }
        if (
          /WHERE \[Provider\] = @provider\s+AND \[ProviderMessageID\] = @providerMessageId/i.test(text)
        ) {
          const key = providerKey(String(params.provider), String(params.providerMessageId));
          const row = byProviderMessage.get(key);
          Object.keys(params).forEach((keyName) => delete params[keyName]);
          return { recordset: row ? [{ ...row }] : [] };
        }
        if (/ORDER BY \[ReceivedAt\] DESC,\s*\[ID\] DESC/i.test(text)) {
          const result = list(params);
          Object.keys(params).forEach((keyName) => delete params[keyName]);
          return result;
        }
        Object.keys(params).forEach((keyName) => delete params[keyName]);
        throw new Error(`Unexpected SQL in test fake: ${text.slice(0, 120)}`);
      },
    };
  }

  return { reset, request, byId, byProviderMessage };
});

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({ request: () => db.request() })),
  sql: {
    MAX: 65535,
    Int: {},
    BigInt: {},
    DateTime2: {},
    Bit: {},
    NVarChar: () => ({}),
  },
}));

import { ingestIncomingMessage } from '@/modules/messaging/inbox/application/ingestIncomingMessage';
import {
  countByProviderMessage,
  getByProviderMessage,
  insert,
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

describe('message inbox Phase 1 ingestion', () => {
  beforeEach(() => {
    db.reset();
  });

  it('Test A — first message creates one pending row with duplicate=false', async () => {
    const result = await ingestIncomingMessage(BASE_INPUT);
    expect(result.duplicate).toBe(false);
    expect(result.inboxId).toBeGreaterThan(0);

    const row = await getByProviderMessage('whatsapp-web', 'phase1-test-001');
    expect(row?.status).toBe('pending');
    expect(row?.text).toBe('عايز احجز بكرة');
    expect(db.byId.size).toBe(1);
  });

  it('Test B — exact duplicate returns same inbox id without a second row', async () => {
    const first = await ingestIncomingMessage(BASE_INPUT);
    const second = await ingestIncomingMessage(BASE_INPUT);

    expect(second.duplicate).toBe(true);
    expect(second.inboxId).toBe(first.inboxId);
    expect(db.byId.size).toBe(1);
    expect(await countByProviderMessage('whatsapp-web', 'phase1-test-001')).toBe(1);
  });

  it('Test C — same text with different provider message ids creates two rows', async () => {
    const first = await ingestIncomingMessage(BASE_INPUT);
    const second = await ingestIncomingMessage({
      ...BASE_INPUT,
      providerMessageId: 'phase1-test-002',
      text: 'تمام',
    });
    const third = await ingestIncomingMessage({
      ...BASE_INPUT,
      providerMessageId: 'phase1-test-003',
      text: 'تمام',
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(false);
    expect(third.duplicate).toBe(false);
    expect(new Set([first.inboxId, second.inboxId, third.inboxId]).size).toBe(3);
    expect(db.byId.size).toBe(3);
  });

  it('Test D — concurrent duplicate ingestion creates exactly one row', async () => {
    const [a, b] = await Promise.all([
      ingestIncomingMessage(BASE_INPUT),
      ingestIncomingMessage(BASE_INPUT),
    ]);
    expect(a.inboxId).toBe(b.inboxId);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(db.byId.size).toBe(1);
  });

  it('Test E — Arabic text round-trips correctly', async () => {
    const arabic = 'مرحبا، أريد حجز موعد غداً الساعة ٣';
    const result = await ingestIncomingMessage({
      ...BASE_INPUT,
      providerMessageId: 'phase1-test-arabic',
      text: arabic,
    });
    const row = await getByProviderMessage('whatsapp-web', 'phase1-test-arabic');
    expect(result.duplicate).toBe(false);
    expect(row?.text).toBe(arabic);
  });

  it('Test F — missing provider message id is rejected', async () => {
    await expect(
      ingestIncomingMessage({
        ...BASE_INPUT,
        providerMessageId: '',
      }),
    ).rejects.toMatchObject({ code: 'MISSING_PROVIDER_MESSAGE_ID' });
    expect(db.byId.size).toBe(0);
  });

  it('stores group messages as ignored without processing', async () => {
    const result = await ingestIncomingMessage({
      ...BASE_INPUT,
      providerMessageId: 'phase1-test-group',
      isGroup: true,
    });
    const row = await getByProviderMessage('whatsapp-web', 'phase1-test-group');
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
    const first = await insert(record);
    const second = await insert(record);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.row.id).toBe(first.row.id);
  });
});
