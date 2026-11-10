/**
 * Pure editor operations. Nothing here persists, prints, or touches sale data.
 * The v1 UI keeps its draft in React memory until SQL drafts are introduced.
 */
import { validateReceiptTemplateV1, type ReceiptBlockV1, type ReceiptTemplateV1 } from './template';
import { addTreeNode, moveTreeNode, updateTreeNode, removeTreeNode } from './tree';

export type SampleScenario = 'one' | 'three' | 'twelve' | 'long';
export type SampleLine = { name: string; price: number; qty: number };
export type SampleReceipt = {
  invoiceNo: string; branch: string; customer: string; date: string;
  time: string; items: SampleLine[]; subtotal: number; discount: number;
  total: number; payment: string;
};

const SAMPLE_ITEMS: SampleLine[] = [
  { name: 'Hair Cut', price: 180, qty: 1 },
  { name: 'Beard Trim', price: 120, qty: 1 },
  { name: 'Oil Bath', price: 150, qty: 1 },
  { name: 'Skin Care', price: 160, qty: 1 },
  { name: 'Hair Styling', price: 90, qty: 1 },
  { name: 'Hair Wash', price: 70, qty: 1 },
  { name: 'Hair Mask', price: 200, qty: 1 },
  { name: 'Classic Shave', price: 100, qty: 1 },
  { name: 'Hot Towel', price: 50, qty: 1 },
  { name: 'Protein Treatment', price: 600, qty: 1 },
  { name: 'Hair Color', price: 250, qty: 1 },
  { name: 'Scalp Massage', price: 80, qty: 1 },
];

export function getSampleReceipt(scenario: SampleScenario): SampleReceipt {
  const items = scenario === 'one' ? SAMPLE_ITEMS.slice(0, 1)
    : scenario === 'twelve' ? SAMPLE_ITEMS
    : scenario === 'long' ? [
      { name: 'Premium Hair Cut & Professional Hair Styling Session', price: 300, qty: 1 },
      { name: 'Full Beard Shaping and Hot Towel Treatment', price: 200, qty: 1 },
      { name: 'Complete Hair Care & Repair Treatment Package', price: 450, qty: 1 },
    ] : SAMPLE_ITEMS.slice(0, 3);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = scenario === 'one' ? 0 : 30;
  return {
    invoiceNo: '#10248', branch: 'GLEEM · SABA PASHA', customer: 'Walk-in Customer',
    date: '10/11/2026', time: '10:45 PM', items,
    subtotal, discount, total: Math.max(0, subtotal - discount), payment: 'Cash',
  };
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function reorderReceiptBlocks(template: ReceiptTemplateV1, sourceId: string, targetId: string) {
  return moveTreeNode(template, sourceId, targetId, 'before');
}

export function updateReceiptBlock(template: ReceiptTemplateV1, id: string, patch: Partial<ReceiptBlockV1>) {
  return updateTreeNode(template, id, patch);
}

export function addReceiptDecoration(template: ReceiptTemplateV1, kind: 'text' | 'divider', parentId: string | null = null) {
  return addTreeNode(template, kind, parentId);
}

export function deleteReceiptDecoration(template: ReceiptTemplateV1, id: string) {
  return removeTreeNode(template, id);
}

export function setReceiptMinHeight(template: ReceiptTemplateV1, mm: number) {
  const candidate = { ...template, paper: { ...template.paper, minHeightMm: mm } };
  return validateReceiptTemplateV1(candidate).ok ? candidate : template;
}

export function addReceiptImage(template: ReceiptTemplateV1, assetId: string, parentId: string | null = null) {
  return addTreeNode(template, 'image', parentId, assetId);
}
