import { describe, expect, it } from 'vitest';
import {
  COMPACT_CUT_RECEIPT_V1,
  validateReceiptTemplateV1,
} from '../template';

function editable(): Record<string, unknown> {
  return structuredClone(COMPACT_CUT_RECEIPT_V1) as unknown as Record<string, unknown>;
}

describe('Receipt Studio V1 contract', () => {
  it('accepts a compact 80/72mm auto-height receipt without changing production', () => {
    const result = validateReceiptTemplateV1(COMPACT_CUT_RECEIPT_V1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.template.paper.printableWidthMm).toBe(72);
      expect(result.template.paper.heightMode).toBe('auto');
    }
  });

  it('rejects a user-selected 3-meter fixed page size', () => {
    const input = editable();
    input.paper = { rollWidthMm: 80, printableWidthMm: 72, heightMode: 'fixed', minHeightMm: 3276 };
    const result = validateReceiptTemplateV1(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('heightMode'))).toBe(true);
  });

  it('refuses missing or hidden mandatory items/totals', () => {
    const input = editable();
    const blocks = input.blocks as Array<{ kind: string; enabled: boolean }>;
    blocks.find((b) => b.kind === 'totals')!.enabled = false;
    const result = validateReceiptTemplateV1(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('enabled totals'))).toBe(true);
  });

  it('keeps totals after the dynamic items table', () => {
    const input = editable();
    const blocks = input.blocks as Array<{ kind: string }>;
    const items = blocks.findIndex((b) => b.kind === 'items');
    const totals = blocks.findIndex((b) => b.kind === 'totals');
    [blocks[items], blocks[totals]] = [blocks[totals], blocks[items]];
    const result = validateReceiptTemplateV1(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('totals must follow items'))).toBe(true);
  });

  it('rejects arbitrary HTML/CSS / unknown unsafe extensions', () => {
    const input = editable();
    input.customHTML = '<script>alert(1)</script>';
    const blocks = input.blocks as Array<{ kind: string; style: Record<string, unknown> }>;
    blocks[0].style = { position: 'absolute', left: '-999999px' };
    const result = validateReceiptTemplateV1(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('customHTML'))).toBe(true);
    expect(result.errors.some((e) => e.includes('position'))).toBe(true);
  });

  it('rejects image blocks without registered asset references and duplicate IDs', () => {
    const input = editable();
    const blocks = input.blocks as Array<Record<string, unknown>>;
    blocks.push({ id: 'brand', kind: 'image', enabled: true });
    const result = validateReceiptTemplateV1(input);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate identifier'))).toBe(true);
    expect(result.errors.some((e) => e.includes('invalid asset identifier'))).toBe(true);
  });

  it('allows optional, short static text and minimum paper height', () => {
    const input = editable();
    input.paper = { rollWidthMm: 80, printableWidthMm: 72, heightMode: 'auto', minHeightMm: 120 };
    (input.blocks as Array<Record<string, unknown>>).push({
      id: 'promotion',
      kind: 'text',
      enabled: true,
      text: 'Thank you for visiting CUT SALON',
      style: { align: 'center', fontSizePx: 11 },
    });
    expect(validateReceiptTemplateV1(input).ok).toBe(true);
  });
});
