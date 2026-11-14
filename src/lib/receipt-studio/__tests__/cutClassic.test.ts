import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPACT_CUT_RECEIPT_V1, CUT_CLASSIC_ORIGINAL_V1,
  newCutClassicEditableCopy, validateReceiptTemplateV1,
} from '../template';
import { CUT_CLASSIC_ORIGINAL_CSS } from '../classicStyle';
import { renderStudioReceiptHtml, type StudioInvoiceModel } from '../render';

const invoice: StudioInvoiceModel = {
  invoiceNo: '11099', date: '14/11/2026', time: '22:49',
  brand: 'CUT SALON', brandWordmark: 'CUT', branch: 'GLEEM',
  customer: 'Ahmed', customerPhone: '01000000000', phone: '01012126899',
  items: [
    { name: 'Hair Cut', employee: 'Ziad', price: 200 },
    { name: 'Beard Trim', employee: 'Ziad', price: 120 },
  ],
  subtotal: 320, discounts: [{ label: 'خصم الفاتورة', amount: 20 }],
  grandTotal: 300, payments: [{ label: 'Cash' }],
};

describe('CUT Classic original receipt preservation and editability', () => {
  it('accepts the protected original without any database or live invoice change', () => {
    expect(validateReceiptTemplateV1(CUT_CLASSIC_ORIGINAL_V1).ok).toBe(true);
    expect(CUT_CLASSIC_ORIGINAL_V1.layoutVariant).toBe('classic');
    expect(CUT_CLASSIC_ORIGINAL_V1.paper).toMatchObject({
      rollWidthMm: 80, printableWidthMm: 72, heightMode: 'auto',
    });
    expect(COMPACT_CUT_RECEIPT_V1.layoutVariant).toBeUndefined();
  });

  it('creates editable copies without mutating the original master', () => {
    const first = newCutClassicEditableCopy();
    const second = newCutClassicEditableCopy();
    const brand = first.blocks.find(b => b.kind === 'brand')!;
    brand.fields = { ...brand.fields, brandName: 'CUT SALON edited' };
    const gift = first.blocks.find(b => b.id === 'classic_gift')!;
    gift.text = 'هدية جديدة';
    expect(first).not.toEqual(CUT_CLASSIC_ORIGINAL_V1);
    expect(second).toEqual(CUT_CLASSIC_ORIGINAL_V1);
    expect(CUT_CLASSIC_ORIGINAL_V1.blocks.find(b => b.id === 'classic_gift')?.text).toBe('اسأل على هديتك');
    expect(validateReceiptTemplateV1(first).ok).toBe(true);
  });

  it('reuses the exact old production receipt CSS rather than approximating the frame', () => {
    const invoiceSource = readFileSync(join(process.cwd(), 'src/components/pos/PrintInvoiceModal.tsx'), 'utf8');
    expect(invoiceSource).toContain("import { CUT_CLASSIC_ORIGINAL_CSS } from '@/lib/receipt-studio/classicStyle';");
    expect(invoiceSource).toContain('const THERMAL_CSS = CUT_CLASSIC_ORIGINAL_CSS;');
    for (const marker of ['.receipt-frame', '.receipt-frame::before', '.logo-circle', '.barber-pole',
      '.receipt-info', '.receipt-totals', '.gift-section', '.receipt-footer', '.footer-ornament']) {
      expect(CUT_CLASSIC_ORIGINAL_CSS).toContain(marker);
    }
  });

  it('renders a complete decorated CUT Classic invoice with data still dynamic', () => {
    const html = renderStudioReceiptHtml(CUT_CLASSIC_ORIGINAL_V1, invoice);
    expect(html).toContain('data-layout-variant="classic"');
    for (const marker of ['class="receipt-frame"', 'class="logo-circle"', 'class="receipt-title"',
      'class="receipt-info"', 'class="receipt-totals"', 'class="gift-section"',
      'class="receipt-footer"', 'class="barber-pole-small"']) {
      expect(html).toContain(marker);
    }
    expect(html).toContain('#11099');
    expect(html).toContain('Hair Cut');
    expect(html).toContain('Beard Trim');
    expect(html).toContain('Ziad');
    expect(html).toContain('300.00 ج.م');
    expect(html).toContain('اسأل على هديتك');
    expect(html).toContain('01000000000');
  });

  it('reflects edits in the copy only while preserving escaped sale data', () => {
    const copy = newCutClassicEditableCopy();
    const totals = copy.blocks.find(b => b.kind === 'totals')!;
    totals.fields = { ...totals.fields, totalLabel: 'المدفوع:' };
    const gift = copy.blocks.find(b => b.id === 'classic_gift')!;
    gift.text = 'هدية CUT';
    const html = renderStudioReceiptHtml(copy, {
      ...invoice, customer: '<script>alert(1)</script>',
      items: [{ name: '<img src=x onerror=alert(1)>', price: 150 }],
    });
    expect(html).toContain('المدفوع:');
    expect(html).toContain('هدية CUT');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const masterHtml = renderStudioReceiptHtml(CUT_CLASSIC_ORIGINAL_V1, invoice);
    expect(masterHtml).toContain('الإجمالي:');
    expect(masterHtml).toContain('اسأل على هديتك');
  });

  it('prevents unapproved HTML/CSS properties and unsafe alternate variants', () => {
    const copy = newCutClassicEditableCopy() as unknown as Record<string, unknown>;
    copy.layoutVariant = '<script>';
    expect(validateReceiptTemplateV1(copy).ok).toBe(false);
    copy.layoutVariant = 'classic';
    copy.rawHTML = '<script>alert(1)</script>';
    expect(validateReceiptTemplateV1(copy).ok).toBe(false);
  });
});
