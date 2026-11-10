/**
 * Pure editor operations. Nothing here persists, prints, or touches sale data.
 * The v1 UI keeps its draft in React memory until SQL drafts are introduced.
 */
import { validateReceiptTemplateV1, type ReceiptBlockV1, type ReceiptTemplateV1 } from './template';

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

export function reorderReceiptBlocks(
  template: ReceiptTemplateV1, sourceId: string, targetId: string,
): ReceiptTemplateV1 {
  const from = template.blocks.findIndex((b) => b.id === sourceId);
  const to = template.blocks.findIndex((b) => b.id === targetId);
  if (from < 0 || to < 0 || from === to) return template;
  const blocks = [...template.blocks];
  const [block] = blocks.splice(from, 1);
  blocks.splice(to, 0, block);
  const candidate = { ...template, blocks };
  return validateReceiptTemplateV1(candidate).ok ? candidate : template;
}

export function updateReceiptBlock(
  template: ReceiptTemplateV1, id: string, patch: Partial<ReceiptBlockV1>,
): ReceiptTemplateV1 {
  if (!template.blocks.some((b) => b.id === id)) return template;
  const blocks = template.blocks.map((b) => b.id === id
    ? { ...b, ...patch, style: patch.style === undefined ? b.style : { ...b.style, ...patch.style } }
    : b);
  const candidate = { ...template, blocks };
  return validateReceiptTemplateV1(candidate).ok ? candidate : template;
}

export function addReceiptDecoration(
  template: ReceiptTemplateV1, kind: 'text' | 'divider',
): ReceiptTemplateV1 {
  const used = new Set(template.blocks.map((b) => b.id));
  let index = 1;
  while (used.has(`block_${index}`)) index++;
  const block: ReceiptBlockV1 = kind === 'text'
    ? { id: `block_${index}`, kind: 'text', enabled: true, text: 'MORE THAN A HAIRCUT', style: { align: 'center', fontSizePx: 11, gapAfterMm: 1 } }
    : { id: `block_${index}`, kind: 'divider', enabled: true, style: { gapAfterMm: 1 } };
  const candidate = { ...template, blocks: [...template.blocks, block] };
  return validateReceiptTemplateV1(candidate).ok ? candidate : template;
}

export function deleteReceiptDecoration(template: ReceiptTemplateV1, id: string): ReceiptTemplateV1 {
  const selected = template.blocks.find((b) => b.id === id);
  if (!selected || !['text', 'divider'].includes(selected.kind)) return template;
  const candidate = { ...template, blocks: template.blocks.filter((b) => b.id !== id) };
  return validateReceiptTemplateV1(candidate).ok ? candidate : template;
}

export function setReceiptMinHeight(template: ReceiptTemplateV1, mm: number): ReceiptTemplateV1 {
  const candidate: ReceiptTemplateV1 = { ...template, paper: { ...template.paper, minHeightMm: mm } };
  return validateReceiptTemplateV1(candidate).ok ? candidate : template;
}
