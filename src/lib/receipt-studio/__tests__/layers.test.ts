import { describe, expect, it } from 'vitest';
import {
  COMPACT_CUT_RECEIPT_V1, validateReceiptTemplateV1,
  flattenReceiptBlocks,
} from '../template';
import {
  addTreeNode, allReceiptNodes, duplicateTreeNode, findReceiptNode,
  groupReceiptNodes, moveTreeNode, removeTreeNode, treeNodeParentId,
  ungroupReceiptNode, updateTreeNode,
} from '../tree';
import { renderStudioReceiptHtml } from '../render';

const fresh = () => structuredClone(COMPACT_CUT_RECEIPT_V1);
const data = {
  invoiceNo: '778', date: '10/11/2026', time: '10:45', branch: 'GLEEM',
  brand: 'CUT SALON', customer: 'Guest',
  items: [{ name: 'Hair Cut', price: 200 }, { name: 'Beard Trim', price: 120 }],
  subtotal: 320, discounts: [{ label: 'Coupon', amount: 20 }],
  grandTotal: 300, payments: [{ label: 'Cash' }],
};

describe('Receipt Studio nested groups and real layers', () => {
  it('groups any two sibling elements, preserving their order and JSON compatibility', () => {
    const grouped = groupReceiptNodes(fresh(), ['brand', 'meta']);
    expect(grouped).not.toEqual(fresh());
    const group = grouped.blocks[0];
    expect(group.kind).toBe('group');
    expect(group.children?.map((c) => c.id)).toEqual(['brand', 'meta']);
    expect(validateReceiptTemplateV1(grouped).ok).toBe(true);
    expect(flattenReceiptBlocks(grouped.blocks).map((x) => x.id)).toEqual(fresh().blocks.map((x) => x.id));
  });

  it('supports group inside group, nested layer lookup, and ungroup', () => {
    let t = groupReceiptNodes(fresh(), ['brand', 'meta']);
    const g = t.blocks[0].id;
    t = moveTreeNode(t, 'items', g, 'inside');
    expect(treeNodeParentId(t.blocks, 'items')).toBe(g);
    expect(findReceiptNode(t.blocks, 'items')?.kind).toBe('items');
    const inner = groupReceiptNodes(t, ['brand', 'meta']);
    expect(findReceiptNode(inner.blocks, g)?.children?.[0].kind).toBe('group');
    expect(validateReceiptTemplateV1(inner).ok).toBe(true);
    const unpacked = ungroupReceiptNode(inner, g);
    expect(validateReceiptTemplateV1(unpacked).ok).toBe(true);
    expect(allReceiptNodes(unpacked.blocks).filter((x) => x.kind === 'group')).toHaveLength(1);
  });

  it('rejects hiding groups with mandatory financial elements or illegal totals order', () => {
    let t = groupReceiptNodes(fresh(), ['meta', 'items']);
    const g = t.blocks[1].id;
    expect(updateTreeNode(t, g, { enabled: false })).toBe(t);
    expect(moveTreeNode(t, 'totals', g, 'inside')).toBe(t);
    expect(removeTreeNode(t, g)).toBe(t);
  });

  it('allows safe text / image duplicates and group-scoped edits', () => {
    let t = addTreeNode(fresh(), 'group');
    const groupId = t.blocks.at(-1)!.id;
    t = addTreeNode(t, 'text', groupId);
    const textId = findReceiptNode(t.blocks, groupId)!.children![0].id;
    t = updateTreeNode(t, textId, { text: 'Visit again!' });
    expect(findReceiptNode(t.blocks, textId)?.text).toBe('Visit again!');
    t = duplicateTreeNode(t, textId);
    expect(findReceiptNode(t.blocks, groupId)!.children).toHaveLength(2);
    expect(validateReceiptTemplateV1(t).ok).toBe(true);
    t = addTreeNode(t, 'image', groupId, '550e8400-e29b-41d4-a716-446655440000');
    expect(findReceiptNode(t.blocks, groupId)!.children?.some((x) => x.kind === 'image')).toBe(true);
  });

  it('can lock and unlock layers, never edit locked text', () => {
    let t = addTreeNode(fresh(), 'text');
    const id = t.blocks.at(-1)!.id;
    t = updateTreeNode(t, id, { locked: true });
    expect(updateTreeNode(t, id, { text: 'tamper' })).toBe(t);
    t = updateTreeNode(t, id, { locked: false });
    expect(updateTreeNode(t, id, { text: 'allowed' })).not.toBe(t);
  });

  it('prints editable English headers and nested text exactly once, with escaped content', () => {
    let t = groupReceiptNodes(fresh(), ['brand', 'meta']);
    t = updateTreeNode(t, 'brand', { fields: { brandName: 'CUT <DELUXE>' } });
    t = updateTreeNode(t, 'items', { fields: {
      numberHeader: 'ID', serviceHeader: 'TREATMENT', priceHeader: 'EGP',
    }});
    t = updateTreeNode(t, 'totals', { fields: { totalLabel: 'AMOUNT DUE' }});
    const html = renderStudioReceiptHtml(t, data);
    expect(html).toContain('CUT &lt;DELUXE&gt;');
    expect(html).toContain('TREATMENT');
    expect(html).toContain('AMOUNT DUE');
    expect(html).toContain('300.00 EGP');
    expect(html).toContain('data-edit-field="serviceHeader"');
    expect(html).toContain('data-block-id="brand"');
    expect(html).not.toContain('<DELUXE>');
    expect(html).not.toContain('3276mm');
  });

  it('rejects malicious CSS keys, invalid nesting and more than 6 images', () => {
    let t = addTreeNode(fresh(), 'group');
    const groupId = t.blocks.at(-1)!.id;
    expect(updateTreeNode(t, groupId, { style: { paddingMm: 999 } })).toBe(t);
    expect(updateTreeNode(t, 'items', { style: { position: 'absolute' } } as never)).toBe(t);
    for (let i = 0; i < 6; i++) {
      const uuid = `550e8400-e29b-41d4-a716-44665544000${i}`;
      t = addTreeNode(t, 'image', groupId, uuid);
    }
    expect(allReceiptNodes(t.blocks).filter((x) => x.kind === 'image')).toHaveLength(6);
    expect(addTreeNode(t, 'image', groupId, '550e8400-e29b-41d4-a716-446655440006')).toBe(t);
  });
});
