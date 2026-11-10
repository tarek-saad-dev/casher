import { describe, expect, it } from 'vitest';
import {
  addReceiptDecoration,
  deleteReceiptDecoration,
  getSampleReceipt,
  reorderReceiptBlocks,
  setReceiptMinHeight,
  updateReceiptBlock,
} from '../editor';
import { COMPACT_CUT_RECEIPT_V1, validateReceiptTemplateV1 } from '../template';

const copy = () => structuredClone(COMPACT_CUT_RECEIPT_V1);

describe('Receipt Studio visual editor actions', () => {
  it('generates 1, 3, 12 and long-name fixtures with calculated totals', () => {
    expect(getSampleReceipt('one').items).toHaveLength(1);
    expect(getSampleReceipt('three').items).toHaveLength(3);
    expect(getSampleReceipt('twelve').items).toHaveLength(12);
    expect(getSampleReceipt('long').items[0].name.length).toBeGreaterThan(30);
    for (const sample of ['one', 'three', 'twelve', 'long'] as const) {
      const data = getSampleReceipt(sample);
      expect(data.total).toBe(data.subtotal - data.discount);
      expect(data.items.every((i) => i.name.length > 0 && i.price > 0)).toBe(true);
    }
  });

  it('moves safe sections but rejects totals before items', () => {
    const initial = copy();
    const moved = reorderReceiptBlocks(initial, 'footer', 'brand');
    expect(moved.blocks[0].id).toBe('thanks');
    const rejected = reorderReceiptBlocks(initial, 'totals', 'items');
    expect(rejected).toBe(initial);
    expect(validateReceiptTemplateV1(moved).ok).toBe(true);
  });

  it('does not allow hiding required blocks or inserting arbitrary HTML', () => {
    const initial = copy();
    expect(updateReceiptBlock(initial, 'items', { enabled: false })).toBe(initial);
    expect(updateReceiptBlock(initial, 'brand', { text: '<img src=x onerror=alert(1)>' })).toBe(initial);
  });

  it('edits style within bounds and rejects CSS injection and huge fonts', () => {
    const initial = copy();
    const updated = updateReceiptBlock(initial, 'brand', { style: { fontSizePx: 30 } });
    expect(updated).not.toBe(initial);
    expect(updated.blocks[0].style?.fontSizePx).toBe(30);
    expect(updateReceiptBlock(initial, 'brand', { style: { fontSizePx: 1000 } })).toBe(initial);
    expect(updateReceiptBlock(initial, 'brand', { style: { unknownCss: 'url(evil)' } } as never)).toBe(initial);
  });

  it('supports bounded auto-height minimum, never a fixed 3276mm roll', () => {
    const initial = copy();
    const updated = setReceiptMinHeight(initial, 100);
    expect(updated.paper.heightMode).toBe('auto');
    expect(updated.paper.minHeightMm).toBe(100);
    expect(setReceiptMinHeight(initial, 3276)).toBe(initial);
  });

  it('adds and removes optional text/divider but preserves mandatory sections', () => {
    const initial = copy();
    const withText = addReceiptDecoration(initial, 'text');
    const withDivider = addReceiptDecoration(withText, 'divider');
    expect(withDivider.blocks).toHaveLength(initial.blocks.length + 2);
    expect(validateReceiptTemplateV1(withDivider).ok).toBe(true);
    expect(deleteReceiptDecoration(withDivider, 'items')).toBe(withDivider);
    const textId = withText.blocks.at(-1)!.id;
    expect(deleteReceiptDecoration(withDivider, textId).blocks).toHaveLength(initial.blocks.length + 1);
  });
});
