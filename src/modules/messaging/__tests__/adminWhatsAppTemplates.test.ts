import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import type { MessageTemplateStoredRow } from '@/modules/messaging/templates/repository/messageTemplateRepository';
import { SALE_CUSTOMER_RECEIPT_DEFAULT_TEMPLATE } from '@/modules/messaging/templates/defaults/saleCustomerReceipt';
import { renderTemplate } from '@/modules/messaging/templates/renderTemplate';

const requireAdmin = vi.fn();
const requireActiveBranchContext = vi.fn();
const sendWhatsAppMessage = vi.fn();
const sendMessage = vi.fn();

const repo = vi.hoisted(() => {
  const rows: MessageTemplateStoredRow[] = [];
  let nextId = 1;

  function reset(seed: MessageTemplateStoredRow[] = []) {
    rows.splice(0, rows.length, ...seed.map((row) => ({ ...row })));
    nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  }

  async function listMessageTemplateRows(input: {
    templateKeys: string[];
    language: string;
    branchId: number;
  }) {
    return rows
      .filter(
        (row) =>
          input.templateKeys.includes(row.templateKey) &&
          row.language === input.language &&
          (row.branchId === input.branchId || row.branchId == null),
      )
      .map((row) => ({ ...row }));
  }

  async function upsertBranchMessageTemplateOverride(input: {
    channel: 'whatsapp';
    templateKey: string;
    language: string;
    branchId: number;
    content: string;
    userId: number;
  }) {
    const existing = rows
      .filter(
        (row) =>
          row.templateKey === input.templateKey &&
          row.language === input.language &&
          row.branchId === input.branchId,
      )
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.version - a.version || b.id - a.id);

    const now = new Date().toISOString();
    const current = existing[0];
    if (current) {
      current.content = input.content;
      current.isActive = true;
      current.version += 1;
      current.updatedByUserId = input.userId;
      current.updatedAt = now;
      return { ...current };
    }

    const created: MessageTemplateStoredRow = {
      id: nextId++,
      templateKey: input.templateKey,
      channel: input.channel,
      branchId: input.branchId,
      language: input.language,
      content: input.content,
      isActive: true,
      version: 1,
      createdByUserId: input.userId,
      updatedByUserId: null,
      createdAt: now,
    };
    rows.push(created);
    return { ...created };
  }

  async function deactivateBranchMessageTemplateOverride(input: {
    templateKey: string;
    language: string;
    branchId: number;
    userId: number;
  }) {
    const existing = rows.filter(
      (row) =>
        row.templateKey === input.templateKey &&
        row.language === input.language &&
        row.branchId === input.branchId,
    );
    const active = existing.find((row) => row.isActive);
    if (!active) {
      return { changed: false, row: existing[0] ? { ...existing[0] } : null };
    }
    active.isActive = false;
    active.version += 1;
    active.updatedByUserId = input.userId;
    active.updatedAt = new Date().toISOString();
    return { changed: true, row: { ...active } };
  }

  return {
    rows,
    reset,
    listMessageTemplateRows,
    upsertBranchMessageTemplateOverride,
    deactivateBranchMessageTemplateOverride,
  };
});

vi.mock('@/lib/api-auth', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  isAuthResult: (value: { ok?: boolean }) => value?.ok === true,
}));

vi.mock('@/lib/branch/context', () => ({
  requireActiveBranchContext: (...args: unknown[]) => requireActiveBranchContext(...args),
}));

vi.mock('@/lib/integrations/whatsapp', () => ({
  sendWhatsAppMessage: (...args: unknown[]) => sendWhatsAppMessage(...args),
}));

vi.mock('@/modules/messaging/application/sendMessage', () => ({
  sendMessage: (...args: unknown[]) => sendMessage(...args),
}));

vi.mock('@/modules/messaging/templates/repository/messageTemplateRepository', () => ({
  listMessageTemplateRows: (...args: unknown[]) =>
    repo.listMessageTemplateRows(...(args as [never])),
  upsertBranchMessageTemplateOverride: (...args: unknown[]) =>
    repo.upsertBranchMessageTemplateOverride(...(args as [never])),
  deactivateBranchMessageTemplateOverride: (...args: unknown[]) =>
    repo.deactivateBranchMessageTemplateOverride(...(args as [never])),
}));

import { GET as GET_LIST } from '@/app/api/admin/whatsapp/templates/route';
import {
  GET as GET_ONE,
  PUT,
  DELETE,
} from '@/app/api/admin/whatsapp/templates/[templateKey]/route';
import { POST as PREVIEW } from '@/app/api/admin/whatsapp/templates/[templateKey]/preview/route';
import { buildAdminWhatsAppTemplateView } from '@/modules/messaging/application/adminWhatsAppTemplates';
import { getWhatsAppTemplateDefinition } from '@/modules/messaging/templates/definitions';

const KEY = 'sale.customer_receipt';
const ADMIN = {
  ok: true as const,
  userId: 7,
  userName: 'admin',
  userLevel: 'admin',
  roles: ['admin'],
  isSuperAdmin: false,
  activeBranchId: 3,
  activeBranchCode: 'GLEEM',
};
const BRANCH = {
  userId: 7,
  branchId: 3,
  branchCode: 'GLEEM',
  branchName: 'جليم',
  canOperate: true,
};

function params(templateKey = KEY) {
  return { params: Promise.resolve({ templateKey }) };
}

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  const init: { method: string; headers?: Record<string, string>; body?: string } = { method };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url, init);
}

function seedGlobal(overrides: Partial<MessageTemplateStoredRow> = {}): MessageTemplateStoredRow {
  return {
    id: 10,
    templateKey: KEY,
    channel: 'whatsapp',
    branchId: null,
    language: 'ar',
    content: 'عالمي {{customerName}}',
    isActive: true,
    version: 1,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Admin WhatsApp template APIs', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    requireActiveBranchContext.mockReset();
    sendWhatsAppMessage.mockReset();
    sendMessage.mockReset();
    repo.reset();
    requireAdmin.mockResolvedValue(ADMIN);
    requireActiveBranchContext.mockResolvedValue(BRANCH);
  });

  it('returns 401 when unauthenticated', async () => {
    requireAdmin.mockResolvedValue(
      NextResponse.json(
        { error: 'غير مصرح — يرجى تسجيل الدخول', code: 'SESSION_REQUIRED' },
        { status: 401 },
      ),
    );

    const res = await GET_LIST();
    expect(res.status).toBe(401);
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('GET lists effective branch / global / code-default resolution', async () => {
    repo.reset([
      seedGlobal(),
      {
        ...seedGlobal(),
        id: 20,
        branchId: 3,
        content: 'فرع {{customerName}}',
        version: 2,
        isActive: true,
      },
    ]);

    const listed = await GET_LIST();
    const listedBody = await listed.json();
    expect(listed.status).toBe(200);
    expect(listedBody.templates).toHaveLength(12);
    expect(listedBody.templates.map((t: { templateKey: string }) => t.templateKey)).toEqual(
      expect.arrayContaining([
        'sale.customer_receipt',
        'customer.first_time',
        'sale.employee_notification',
        'booking.confirmation',
        'booking.cancellation',
        'employee.advance',
        'employee.funding',
        'attendance.check_in',
        'attendance.check_out',
        'employee.daily_report',
        'owner.daily_report',
        'employee.tip',
      ]),
    );
    const sale = listedBody.templates.find(
      (t: { templateKey: string }) => t.templateKey === KEY,
    );
    expect(sale).toMatchObject({
      templateKey: KEY,
      channel: 'whatsapp',
      language: 'ar',
      effectiveContent: 'فرع {{customerName}}',
      effectiveSource: 'branch_db',
      branchOverride: { id: 20, isActive: true, version: 2 },
      globalTemplate: { id: 10, isActive: true },
    });

    repo.reset([seedGlobal()]);
    const globalOnly = await (
      await GET_ONE(jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'GET'), params())
    ).json();
    expect(globalOnly.template.effectiveSource).toBe('global_db');
    expect(globalOnly.template.effectiveContent).toBe('عالمي {{customerName}}');
    expect(globalOnly.template.branchOverride).toBeNull();

    repo.reset([]);
    const fromCode = await (
      await GET_ONE(jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'GET'), params())
    ).json();
    expect(fromCode.template.effectiveSource).toBe('code_default');
    expect(fromCode.template.effectiveContent).toBe(SALE_CUSTOMER_RECEIPT_DEFAULT_TEMPLATE);
  });

  it('PUT creates a branch override then updates the same row without duplicating', async () => {
    repo.reset([seedGlobal()]);

    const createdRes = await PUT(
      jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'PUT', {
        language: 'ar',
        content: 'أول {{customerName}}',
      }),
      params(),
    );
    const created = await createdRes.json();
    expect(createdRes.status).toBe(200);
    expect(created.template.branchOverride).toMatchObject({
      content: 'أول {{customerName}}',
      version: 1,
      isActive: true,
    });
    expect(created.template.effectiveSource).toBe('branch_db');
    expect(repo.rows.filter((row) => row.branchId === 3)).toHaveLength(1);

    const firstId = created.template.branchOverride.id;
    const updatedRes = await PUT(
      jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'PUT', {
        language: 'ar',
        content: 'ثاني {{customerName}}',
      }),
      params(),
    );
    const updated = await updatedRes.json();
    expect(updated.template.branchOverride).toMatchObject({
      id: firstId,
      content: 'ثاني {{customerName}}',
      version: 2,
      isActive: true,
    });
    expect(repo.rows.filter((row) => row.branchId === 3)).toHaveLength(1);
    expect(repo.rows.filter((row) => row.branchId == null)).toHaveLength(1);
  });

  it('DELETE deactivates the override instead of deleting it and falls back to global', async () => {
    repo.reset([
      seedGlobal(),
      {
        ...seedGlobal(),
        id: 21,
        branchId: 3,
        content: 'فرع {{customerName}}',
        version: 3,
        isActive: true,
      },
    ]);

    const deleted = await DELETE(
      jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'DELETE'),
      params(),
    );
    const body = await deleted.json();
    expect(deleted.status).toBe(200);
    expect(body.template.effectiveSource).toBe('global_db');
    expect(body.template.effectiveContent).toBe('عالمي {{customerName}}');
    expect(body.template.branchOverride).toMatchObject({
      id: 21,
      isActive: false,
      version: 4,
      content: 'فرع {{customerName}}',
    });
    expect(repo.rows.some((row) => row.id === 21)).toBe(true);

    const again = await DELETE(
      jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'DELETE'),
      params(),
    );
    expect(again.status).toBe(200);
    expect(repo.rows.filter((row) => row.id === 21)).toHaveLength(1);
  });

  it('returns 404 for an unknown templateKey', async () => {
    const res = await GET_ONE(
      jsonRequest('http://localhost/api/admin/whatsapp/templates/feature.does_not_exist', 'GET'),
      params('feature.does_not_exist'),
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe('UNKNOWN_TEMPLATE');
  });

  it('rejects empty content with 400', async () => {
    const res = await PUT(
      jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'PUT', {
        language: 'ar',
        content: '   ',
      }),
      params(),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('EMPTY_CONTENT');
    expect(repo.rows.filter((row) => row.branchId === 3)).toHaveLength(0);
  });

  it('rejects an unknown placeholder with 400', async () => {
    const res = await PUT(
      jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'PUT', {
        language: 'ar',
        content: 'مرحبا {{unknownVariable}}',
      }),
      params(),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('UNKNOWN_PLACEHOLDER');
    expect(body.error).toContain('{{unknownVariable}}');
  });

  it('accepts a known placeholder', async () => {
    const res = await PUT(
      jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'PUT', {
        language: 'ar',
        content: 'أستاذ {{customerName}}\nفاتورة {{invoiceNumber}}',
      }),
      params(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.template.branchOverride.content).toContain('{{invoiceNumber}}');
  });

  it('preview uses the same renderer and does not send WhatsApp', async () => {
    const content = 'أستاذ {{customerName}} — {{branchName}}';
    const res = await PREVIEW(
      jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}/preview`, 'POST', {
        content,
      }),
      params(),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      rendered: renderTemplate(content, {
        customerName: 'طارق',
        invoiceNumber: 'INV-10025',
        total: '350',
        paymentMethod: 'كاش',
        branchName: 'جليم',
        employeeName: 'محمد',
        services: 'حلاقة شعر',
      }),
    });
    expect(body.rendered).toBe('أستاذ طارق — جليم');
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();

    const previewSrc = readFileSync(
      path.join(
        process.cwd(),
        'src/app/api/admin/whatsapp/templates/[templateKey]/preview/route.ts',
      ),
      'utf8',
    );
    expect(previewSrc).toContain('previewAdminWhatsAppTemplate');
    expect(previewSrc).not.toContain('sendMessage');
    expect(previewSrc).not.toContain('sendWhatsApp');
  });

  it('does not spoof BranchID from the request body', async () => {
    const spy = vi.spyOn(repo, 'upsertBranchMessageTemplateOverride');
    const res = await PUT(
      jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'PUT', {
        language: 'ar',
        content: 'فرع الجلسة {{customerName}}',
        BranchID: 999,
        branchId: 999,
        channel: 'sms',
      }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      branchId: 3,
      channel: 'whatsapp',
      templateKey: KEY,
      userId: 7,
    });
    expect(repo.rows.every((row) => row.branchId !== 999)).toBe(true);
    spy.mockRestore();
  });
});

describe('template definition and placeholder validation', () => {
  it('keeps schema in code, not in the database', () => {
    const definition = getWhatsAppTemplateDefinition(KEY);
    expect(definition?.label).toBe('رسالة فاتورة العميل');
    expect(definition?.availableVariables.map((item) => item.key)).toContain('customerName');

    const repoSrc = readFileSync(
      path.join(process.cwd(), 'src/modules/messaging/templates/repository/messageTemplateRepository.ts'),
      'utf8',
    );
    expect(repoSrc).not.toContain('availableVariables');
  });

  it('rejects malformed placeholders', async () => {
    requireAdmin.mockResolvedValue(ADMIN);
    requireActiveBranchContext.mockResolvedValue(BRANCH);
    const res = await PUT(
      jsonRequest(`http://localhost/api/admin/whatsapp/templates/${KEY}`, 'PUT', {
        language: 'ar',
        content: 'أستاذ {{customerName',
      }),
      params(),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('MALFORMED_PLACEHOLDER');
  });
});

describe('resolution helper and runtime isolation', () => {
  it('builds the same fallback chain as composeMessage after deactivate', () => {
    const definition = getWhatsAppTemplateDefinition(KEY)!;
    const view = buildAdminWhatsAppTemplateView(
      definition,
      [
        seedGlobal(),
        {
          ...seedGlobal(),
          id: 22,
          branchId: 3,
          content: 'فرع {{customerName}}',
          isActive: false,
          version: 4,
        },
      ],
      3,
    );
    expect(view.effectiveSource).toBe('global_db');
    expect(view.branchOverride?.isActive).toBe(false);
  });

  it('locks branch overrides instead of relying only on unique-index catch', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/modules/messaging/templates/repository/messageTemplateRepository.ts'),
      'utf8',
    );
    expect(src).toContain('UPDLOCK, HOLDLOCK');
    expect(src).toContain('SERIALIZABLE');
    expect(src).toContain('[IsActive] = 0');
    expect(src).toContain('[Version] = [Version] + 1');
    expect(src).not.toMatch(/DELETE\s+FROM\s+\[dbo\]\.\[TblMessageTemplate\]/i);
    expect(src).toContain('AND [BranchID] IS NOT NULL');
  });

  it('does not change the current sale resolution chain', () => {
    const composeSrc = readFileSync(
      path.join(process.cwd(), 'src/modules/messaging/application/composeMessage.ts'),
      'utf8',
    );
    const saleSrc = readFileSync(
      path.join(process.cwd(), 'src/modules/messaging/application/sendSaleCustomerReceipt.ts'),
      'utf8',
    );
    const tplSrc = readFileSync(
      path.join(process.cwd(), 'src/modules/messaging/application/sendTemplateMessage.ts'),
      'utf8',
    );
    const salesRoute = readFileSync(path.join(process.cwd(), 'src/app/api/sales/route.ts'), 'utf8');
    expect(composeSrc).toContain("source: 'code_default'");
    expect(composeSrc).toContain('lookupActiveTemplate');
    expect(saleSrc).toContain('sendTemplateMessage');
    expect(saleSrc).toContain('SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY');
    expect(tplSrc).toContain('composeMessage');
    expect(salesRoute).toContain('sendSaleCustomerReceipt');
    expect(salesRoute).not.toContain('upsertBranchMessageTemplateOverride');
  });

  it('does not change Quick Message', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/app/api/pos/whatsapp/quick-send/route.ts'),
      'utf8',
    );
    expect(src).toContain('sendMessage');
    expect(src).not.toContain('composeMessage');
    expect(src).not.toContain('TblMessageTemplate');
    expect(src).not.toContain('adminWhatsAppTemplates');
  });
});
