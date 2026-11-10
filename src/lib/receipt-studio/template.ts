/**
 * CUT Receipt Studio: safe, tree-based layout contract.
 * Kept at schemaVersion 1 for backwards compatibility with published layouts.
 * "group", "fields" and "children" are optional additive capabilities.
 *
 * No user-supplied arbitrary CSS, HTML, JS, remote image sources or dynamic
 * financial calculations can be stored in a receipt template.
 */
export const RECEIPT_BLOCK_KINDS = [
  'brand', 'invoice-meta', 'items', 'totals', 'payment', 'divider',
  'text', 'image', 'footer', 'group',
] as const;

export type ReceiptBlockKind = (typeof RECEIPT_BLOCK_KIN)[number];
export type ReceiptAlign = 'left' | 'center' | 'right';
export type ReceiptField =
  | 'brandName' | 'brandTagline' | 'receiptLabel' | 'customerLabel'
  | 'numberHeader' | 'serviceHeader' | 'priceHeader'
  | 'subtotalLabel' | 'discountLabel' | 'totalLabel'
  | 'paymentLabel' | 'thanksText' | 'footerTagline';

export interface ReceiptBlockStyle {
  fontSizePx?: number;
  fontWeight?: 400 | 600 | 700 | 800 | 900;
  align?: ReceiptAlign;
  gapAfterMm?: number;
  letterSpacingPx?: number;
  imageWidthMm?: number;
  paddingMm?: number;
  groupGapMm?: number;
}

export interface ReceiptBlockV1 {
  id: string;
  kind: ReceiptBlockKind;
  enabled: boolean;
  name?: string; // editable layers-panel name, not printed
  locked?: boolean; // editor-only; does not suppress rendering
  style?: ReceiptBlockStyle;
  text?: string; // a static text node only
  assetId?: string; // image only; server-verified tenant-owned UUID
  fields?: Partial<Record<ReceiptField, string>>; // editable static labels
  children?: ReceiptBlockV1[]; // group only, nested vertical layout
}

export interface ReceiptTemplateV1 {
  schemaVersion: 1;
  receiptType: 'invoice';
  paper: {
    rollWidthMm: 80;
    printableWidthMm: 72;
    heightMode: 'auto';
    minHeightMm?: number;
  };
  blocks: ReceiptBlockV1[];
}

export const DEFAULT_RECEIPT_FIELDS: Record<ReceiptField, string> = {
  brandName: 'CUT SALON',
  brandTagline: "MEN'S GROOMING",
  receiptLabel: 'RECEIPT',
  customerLabel: 'Customer',
  numberHeader: 'NO.',
  serviceHeader: 'SERVICE',
  priceHeader: 'PRICE',
  subtotalLabel: 'Subtotal',
  discountLabel: 'Discount',
  totalLabel: 'TOTAL',
  paymentLabel: 'Payment',
  thanksText: 'شكراً لزيارتكم',
  footerTagline: 'MORE THAN A HAIRCUT',
};

export const RECEIPT_FIELDS_BY_KIND: Record<ReceiptBlockKind, ReceiptField[]> = {
  brand: ['brandName', 'brandTagline'],
  'invoice-meta': ['receiptLabel', 'customerLabel'],
  items: ['numberHeader', 'serviceHeader', 'priceHeader'],
  totals: ['subtotalLabel', 'discountLabel', 'totalLabel'],
  payment: ['paymentLabel'],
  footer: ['thanksText', 'footerTagline'],
  divider: [], text: [], image: [], group: [],
};

export const COMPACT_CUT_RECEIPT_V1: ReceiptTemplateV1 = {
  schemaVersion: 1,
  receiptType: 'invoice',
  paper: { rollWidthMm: 80, printableWidthMm: 72, heightMode: 'auto' },
  blocks: [
    { id: 'brand', kind: 'brand', enabled: true, style: { align: 'center', fontSizePx: 25, fontWeight: 900, gapAfterMm: 2 } },
    { id: 'meta', kind: 'invoice-meta', enabled: true, style: { fontSizePx: 12, gapAfterMm: 2 } },
    { id: 'items', kind: 'items', enabled: true, style: { fontSizePx: 12, gapAfterMm: 2 } },
    { id: 'totals', kind: 'totals', enabled: true, style: { fontSizePx: 17, fontWeight: 900, gapAfterMm: 1.5 } },
    { id: 'payment', kind: 'payment', enabled: true, style: { fontSizePx: 12, gapAfterMm: 2 } },
    { id: 'thanks', kind: 'footer', enabled: true, style: { align: 'center', fontSizePx: 11 } },
  ],
};

const ROOT_KEYS = new Set(['schemaVersion', 'receiptType', 'paper', 'blocks']);
const PAPER_KEYS = new Set(['rollWidthMm', 'printableWidthMm', 'heightMode', 'minHeightMm']);
const BLOCK_KEYS = new Set(['id', 'kind', 'enabled', 'name', 'locked', 'style', 'text', 'assetId', 'fields', 'children']);
const STYLE_KEYS = new Set(['fontSizePx', 'fontWeight', 'align', 'gapAfterMm', 'letterSpacingPx', 'imageWidthMm', 'paddingMm', 'groupGapMm']);
const KINDS = new Set<string>(RECEIPT_BLOCK_KINDS);
const FONT_WEIGHTS = new Set([400, 600, 700, 800, 900]);
const ALIGNS = new Set(['left', 'center', 'right']);
const MAX_BLOCKS = 48;
const MAX_IMAGE_BLOCKS = 6;
const MAX_DEPTH = 3; // 3 nested groups, no arbitrary/deep recursion

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keyCheck(object: Record<string, unknown>, allowed: Set<string>, path: string, errors: string[]) {
  for (const key of Object.keys(object)) if (!allowed.has(key)) errors.push(`${path}.${key}: unsupported property`);
}
function numeric(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

export type ReceiptTemplateValidation =
  | { ok: true; template: ReceiptTemplateV1; errors: [] }
  | { ok: false; template: null; errors: string[] };

export function flattenReceiptBlocks(blocks: ReceiptBlockV1[]): ReceiptBlockV1[] {
  const out: ReceiptBlockV1[] = [];
  const visit = (items: ReceiptBlockV1[], parentEnabled: boolean) => {
    for (const item of items) {
      if (!parentEnabled || item.enabled === false) continue;
      if (item.kind === 'group') visit(item.children ?? [], true);
      else out.push(item);
    }
  };
  visit(blocks, true);
  return out;
}

/**
 * Validates both previously stored flat templates and new nested groups.
 * Every renderer, editing operation, draft save and publish must validate.
 */
export function validateReceiptTemplateV1(input: unknown): ReceiptTemplateValidation {
  const errors: string[] = [];
  if (!record(input)) return { ok: false, template: null, errors: ['template: expected object'] };
  keyCheck(input, ROOT_KEYS, 'template', errors);
  if (input.schemaVersion !== 1) errors.push('schemaVersion: expected 1');
  if (input.receiptType !== 'invoice') errors.push('receiptType: only invoice supported');

  const paper = input.paper;
  if (!record(paper)) errors.push('paper: expected object');
  else {
    keyCheck(paper, PAPER_KEYS, 'paper', errors);
    if (paper.rollWidthMm !== 80 || paper.printableWidthMm !== 72) errors.push('paper: XP-80 requires 80mm roll / 72mm printable');
    if (paper.heightMode !== 'auto') errors.push('paper.heightMode: must be auto');
    if (paper.minHeightMm !== undefined && !numeric(paper.minHeightMm, 0, 260)) errors.push('paper.minHeightMm: expected 0..260');
  }

  const ids = new Set<string>();
  const fields = new Set<string>(Object.keys(DEFAULT_RECEIPT_FIELDS));
  const typePositions: string[] = [];
  let count = 0;
  let images = 0;
  let mandatoryItems = 0;
  let mandatoryTotals = 0;
  let totalItemNodes = 0;
  let totalTotalNodes = 0;

  const visit = (entries: unknown, depth: number, parentEnabled: boolean, location: string) => {
    if (!Array.isArray(entries)) { errors.push(`${location}: expected blocks array`); return; }
    if (depth === 0 && entries.length < 1) errors.push('blocks: expected at least one block');
    if (depth > MAX_DEPTH) { errors.push(`${location}: group nesting too deep`); return; }
    for (let i = 0; i < entries.length; i++) {
      const b = entries[i] as unknown;
      const at = `${location}[${i}]`;
      count++;
      if (count > MAX_BLOCKS) { errors.push('blocks: maximum 48 total elements'); return; }
      if (!record(b)) { errors.push(`${at}: expected object`); continue; }
      keyCheck(b, BLOCK_KEYS, at, errors);
      if (typeof b.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(b.id)) errors.push(`${at}.id: invalid identifier`);
      else if (ids.has(b.id)) errors.push(`${at}.id: duplicate identifier`);
      else ids.add(b.id);
      if (typeof b.kind !== 'string' || !KINDS.has(b.kind)) errors.push(`${at}.kind: unsupported block`);
      if (typeof b.enabled !== 'boolean') errors.push(`${at}.enabled: expected boolean`);
      if (b.name !== undefined && (typeof b.name !== 'string' || b.name.length > 70)) errors.push(`${at}.name: maximum 70 characters`);
      if (b.locked !== undefined && typeof b.locked !== 'boolean') errors.push(`${at}.locked: expected boolean`);
      const effective = parentEnabled && b.enabled === true;
      if (b.kind === 'items') totalItemNodes++;
      if (b.kind === 'totals') totalTotalNodes++;
      if (b.kind === 'group') {
        if (b.text !== undefined || b.fields !== undefined || b.assetId !== undefined) errors.push(`${at}: groups cannot contain text, fields or assets`);
        visit(b.children, depth + 1, effective, `${at}.children`);
      } else if (b.children !== undefined) {
        errors.push(`${at}.children: only a group may contain children`);
      }
      if (b.kind === 'image') {
        images++;
        if (typeof b.assetId !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(b.assetId)) errors.push(`${at}.assetId: expected registered UUID`);
      } else if (b.assetId !== undefined) errors.push(`${at}.assetId: only image blocks`);
      if (b.kind === 'text') {
        if (typeof b.text !== 'string' || b.text.length > 500) errors.push(`${at}.text: maximum 500 characters`);
      } else if (b.text !== undefined) errors.push(`${at}.text: only text blocks`);
      if (b.fields !== undefined) {
        if (!record(b.fields)) errors.push(`${at}.fields: expected object`);
        else {
          const allowed = RECEIPT_FIELDS_BY_KIND[b.kind as ReceiptBlockKind] ?? [];
          for (const [key, value] of Object.entries(b.fields)) {
            if (!fields.has(key) || !allowed.includes(key as ReceiptField)) errors.push(`${at}.fields.${key}: unsupported label`);
            else if (typeof value !== 'string' || value.length > 90) errors.push(`${at}.fields.${key}: maximum 90 characters`);
          }
        }
      }
      if (b.style !== undefined) {
        if (!record(b.style)) errors.push(`${at}.style: expected object`);
        else {
          keyCheck(b.style, STYLE_KEYS, `${at}.style`, errors);
          if (b.style.fontSizePx !== undefined && !numeric(b.style.fontSizePx, 9, 42)) errors.push(`${at}.style.fontSizePx: expected 9..42`);
          if (b.style.fontWeight !== undefined && !FONT_WEIGHTS.has(b.style.fontWeight as number)) errors.push(`${at}.style.fontWeight: unsupported`);
          if (b.style.align !== undefined && !ALIGNS.has(b.style.align as string)) errors.push(`${at}.style.align: unsupported`);
          if (b.style.gapAfterMm !== undefined && !numeric(b.style.gapAfterMm, 0, 8)) errors.push(`${at}.style.gapAfterMm: expected 0..8`);
          if (b.style.letterSpacingPx !== undefined && !numeric(b.style.letterSpacingPx, 0, 5)) errors.push(`${at}.style.letterSpacingPx: expected 0..5`);
          if (b.style.imageWidthMm !== undefined && (b.kind !== 'image' || !numeric(b.style.imageWidthMm, 8, 66))) errors.push(`${at}.style.imageWidthMm: expected image width 8..66mm`);
          if (b.style.paddingMm !== undefined && (b.kind !== 'group' || !numeric(b.style.paddingMm, 0, 5))) errors.push(`${at}.style.paddingMm: group padding 0..5mm`);
          if (b.style.groupGapMm !== undefined && (b.kind !== 'group' || !numeric(b.style.groupGapMm, 0, 6))) errors.push(`${at}.style.groupGapMm: group gap 0..6mm`);
        }
      }
      if (effective && b.kind !== 'group') {
        typePositions.push(String(b.kind));
        if (b.kind === 'items') mandatoryItems++;
        if (b.kind === 'totals') mandatoryTotals++;
      }
    }
  };
  visit(input.blocks, 0, true, 'blocks');
  if (images > MAX_IMAGE_BLOCKS) errors.push('blocks: maximum 6 images');
  if (mandatoryItems !== 1 || totalItemNodes !== 1) errors.push('blocks: exactly one enabled items block is required');
  if (mandatoryTotals !== 1 || totalTotalNodes !== 1) errors.push('blocks: exactly one enabled totals block is required');
  if (typePositions.indexOf('items') > typePositions.indexOf('totals')) errors.push('blocks: totals must follow items');
  if (errors.length) return { ok: false, template: null, errors };
  return { ok: true, template: input as unknown as ReceiptTemplateV1, errors: [] };
}
