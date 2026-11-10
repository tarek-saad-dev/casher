import { describe, expect, it } from 'vitest';
import { COMPACT_CUT_RECEIPT_V1 } from '../template';
import { renderStudioReceiptHtml, escapeReceiptHtml, type StudioInvoiceModel } from '../render';

const model: StudioInvoiceModel = {
  invoiceNo: '1211', date: '10/11/2026', time: '11:40',
  branch: 'GLEEM', brand: 'CUT SALON', customer: 'Ahmed',
  items: [{ name: 'Hair Cut', price: 200 }, { name: 'Beard Trim', employee: 'Mohamed', price: 100 }],
  subtotal: 300, discounts: [{ label: 'Discount', amount: 30 }],
  grandTotal: 270, payments: [{ label: 'Cash', amount: 270 }],
};

describe('Receipt Studio browser + ESC/POS HTML', () => {
  it('prints English service column headers on 72mm auto-height paper', () => {
    const html = renderStudioReceiptHtml(COMPACT_CUT_RECEIPT_V1, model);
    expect(html).toContain('SERVICE');
    expect(html).toContain('PRICE');
    expect(html).toContain('Hair Cut');
    expect(html).toContain('270.00 EGP');
    expect(html).toContain('width:72mm');
    expect(html).toContain('min-height:0mm');
    expect(html).not.toContain('3276mm');
  });

  it('renders every service without a three-row cap and keeps dynamic totals', () => {
    const many = { ...model, items: Array.from({ length: 12 }, (_, i) => ({
      name: `Hair Cut / Additional Service #${i + 1}`, price: 40,
    })) };
    const html = renderStudioReceiptHtml(COMPACT_CUT_RECEIPT_V1, many);
    for (let i = 1; i <= 12; i++) {
      expect(html).toContain(`Additional Service #${i}`);
    }
    expect((html.match(/class="item-name"/g) || [])).toHaveLength(12);
    expect(html).toContain('270.00 EGP');
  });

  it('escapes dynamic customer/service/employee data and static text', () => {
    const input = { ...model, customer: '<script>alert(1)</script>', items: [{
      name: '<img src=x onerror=alert(1)>', price: 25, employee: 'M & A',
    }] };
    const template = structuredClone(COMPACT_CUT_RECEIPT_V1);
    template.blocks.push({ id: 'safe_text', kind: 'text', enabled: true, text: '<svg onload=alert(1)>' });
    const html = renderStudioReceiptHtml(template, input);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('src=x onerror');
    expect(html).not.toContain('<svg onload');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(escapeReceiptHtml('"x"')).toBe('&quot;x&quot;');
  });

  it('only displays tenant-authorized inline PNGs, rejecting external image URLs', () => {
    const template = structuredClone(COMPACT_CUT_RECEIPT_V1);
    template.blocks.push({ id: 'badge', kind: 'image', enabled: true, assetId: 'abc-def' });
    const html = renderStudioReceiptHtml(template, model, { 'abc-def': 'https://evil.example/tracker.png' });
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('<img');
    const valid = renderStudioReceiptHtml(template, model, { 'abc-def': 'data:image/png;base64,AAAA' });
    expect(valid).toContain('<img');
  });
});
