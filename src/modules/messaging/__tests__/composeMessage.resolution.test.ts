import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  composeMessage,
  MessageTemplateError,
} from '@/modules/messaging/application/composeMessage';
import type { MessageTemplateLookupResult } from '@/modules/messaging/templates/repository/messageTemplateRepository';

const SALE_VARS = { customerName: 'طارق' };

function lookupReturning(hit: MessageTemplateLookupResult | null) {
  return { lookupActiveTemplate: async () => hit };
}

describe('composeMessage template resolution', () => {
  it('prefers a branch DB template over global', async () => {
    const lookup = vi.fn(async () => ({
      content: 'فرع {{customerName}}',
      source: 'branch_db' as const,
    }));
    const result = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: SALE_VARS,
        context: { branchId: 3, language: 'ar' },
      },
      { lookupActiveTemplate: lookup },
    );
    expect(result.source).toBe('branch_db');
    expect(result.text).toBe('فرع طارق');
    expect(lookup).toHaveBeenCalledWith({
      channel: 'whatsapp',
      templateKey: 'sale.customer_receipt',
      language: 'ar',
      branchId: 3,
    });
  });

  it('prefers a global DB template over the code default', async () => {
    const result = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: SALE_VARS,
      },
      lookupReturning({
        content: 'عالمي {{customerName}}',
        source: 'global_db',
      }),
    );
    expect(result.source).toBe('global_db');
    expect(result.text).toBe('عالمي طارق');
    expect(result.text).not.toContain('Cut Salon');
  });

  it('uses the code default when no DB row is returned', async () => {
    const result = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: SALE_VARS,
      },
      lookupReturning(null),
    );
    expect(result.source).toBe('code_default');
    expect(result.text).toBe(`أستاذ طارق
نورت Cut Salon ودايمًا منورنا 🙏✨`);
  });

  it('ignores an inactive/missing branch row by using global, then code default', async () => {
    const fromGlobal = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: SALE_VARS,
        context: { branchId: 3 },
      },
      lookupReturning({
        content: 'عالمي {{customerName}}',
        source: 'global_db',
      }),
    );
    expect(fromGlobal.source).toBe('global_db');

    const fromCode = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: SALE_VARS,
        context: { branchId: 3 },
      },
      lookupReturning(null),
    );
    expect(fromCode.source).toBe('code_default');
  });

  it('ignores empty DB content and falls through to the code default', async () => {
    const ignored = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: SALE_VARS,
      },
      lookupReturning({ content: '   ', source: 'branch_db' }),
    );
    expect(ignored.source).toBe('code_default');
    expect(ignored.text).toContain('أستاذ طارق');
  });

  it('falls back to the code default when DB lookup throws', async () => {
    const result = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: SALE_VARS,
      },
      {
        lookupActiveTemplate: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    );
    expect(result.source).toBe('code_default');
    expect(result.text).toBe(`أستاذ طارق
نورت Cut Salon ودايمًا منورنا 🙏✨`);
  });

  it('throws a controlled error for an unknown key with no DB/default', async () => {
    await expect(
      composeMessage(
        {
          templateKey: 'feature.does_not_exist',
          variables: SALE_VARS,
        },
        lookupReturning(null),
      ),
    ).rejects.toMatchObject({
      name: 'MessageTemplateError',
      code: 'UNKNOWN_TEMPLATE',
    } satisfies Partial<MessageTemplateError>);
  });

  it('resolves booking.confirmation from the code default catalog', async () => {
    const result = await composeMessage(
      {
        templateKey: 'booking.confirmation',
        variables: {
          customerName: 'طارق',
          date: '2026-07-16',
          time: '14:00',
          service: 'حلاقة',
        },
      },
      lookupReturning(null),
    );
    expect(result.source).toBe('code_default');
    expect(result.text).toContain('تم تأكيد حجزك');
    expect(result.text).toContain('طارق');
  });

  it('keeps current sale receipt rendering after seed-equivalent global content', async () => {
    const seeded = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: SALE_VARS,
      },
      lookupReturning({
        content: `أستاذ {{customerName}}
نورت Cut Salon ودايمًا منورنا 🙏✨`,
        source: 'global_db',
      }),
    );
    const fromCode = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: SALE_VARS,
      },
      lookupReturning(null),
    );
    expect(seeded.text).toBe(fromCode.text);
  });
});

describe('message template repository SQL', () => {
  it('filters to active non-empty rows and prefers branch over global', async () => {
    const src = readFileSync(
      path.join(
        process.cwd(),
        'src/modules/messaging/templates/repository/messageTemplateRepository.ts',
      ),
      'utf8',
    );
    expect(src).toContain('[IsActive] = 1');
    expect(src).toContain("LTRIM(RTRIM([Content])) <> N''");
    expect(src).toContain('[BranchID] = @branchId');
    expect(src).toContain('[BranchID] IS NULL');
    expect(src).toContain('CASE WHEN [BranchID] IS NOT NULL THEN 0 ELSE 1 END');
  });

  it('does not wire Quick Message through templates', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/app/api/pos/whatsapp/quick-send/route.ts'),
      'utf8',
    );
    expect(src).toContain('sendMessage');
    expect(src).not.toContain('composeMessage');
    expect(src).not.toContain('TblMessageTemplate');
  });

  it('uses filtered unique indexes that treat NULL BranchID as a global row', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'db/migrations/create-tbl-message-template.sql'),
      'utf8',
    );
    expect(sql).toContain('UX_TblMessageTemplate_ActiveBranch');
    expect(sql).toContain('UX_TblMessageTemplate_ActiveGlobal');
    expect(sql).toContain('[IsActive] = 1 AND [BranchID] IS NOT NULL');
    expect(sql).toContain('[IsActive] = 1 AND [BranchID] IS NULL');
    expect(sql).toContain('AND [BranchID] IS NULL');
    expect(sql).toContain("N'sale.customer_receipt'");
  });
});
