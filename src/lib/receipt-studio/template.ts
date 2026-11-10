/**
 * CUT Receipt Studio v1: pure, allowlisted layout contract.
 *
 * Architecture: docs/receipt-studio/ARCHITECTURE.md.
 * Not wired into live invoice printing; existing invoices stay unchanged.
 *
 * Tenant/branch authorization, persisted SQL revisions, and image ownership are
 * server responsibilities. This file must not use raw HTML or arbitrary CSS.
 */
export const RECEIPT_BLOCK_KINDS = [
  'brand',
  'invoice-meta',
  'items',
  'totals',
  'payment',
  'divider',
  'text',
  'image',
  'footer',
] as const;

export type ReceiptBlockKind = (typeof RECEIPT_BLOCK_KINDS)[number];
export type ReceiptAlign = 'left' | 'center' | 'right';

export interface ReceiptBlockStyle {
  fontSizePx?: number;
  fontWeight?: 400 | 600 | 700 | 800 | 900;
  align?: ReceiptAlign;
  gapAfterMm?: number;
  letterSpacingPx?: number;
}

export interface ReceiptBlockV1 {
  id: string;
  kind: ReceiptBlockKind;
  enabled: boolean;
  style?: ReceiptBlockStyle;
  /** Static copy only. Dynamic sale fields are resolved by the server renderer. */
  text?: string;
  /** Server-issued identifier; the server must check tenant ownership on render. */
  assetId?: string;
}

export interface ReceiptTemplateV1 {
  schemaVersion: 1;
  receiptType: 'invoice';
  paper: {
    rollWidthMm: 80;
    printableWidthMm: 72;
    heightMode: 'auto';
    /** This is only a minimum; rows and totals must never be clipped. */
    minHeightMm?: number;
  };
  blocks: ReceiptBlockV1[];
}

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

const ALLOWED_ROOT = new Set(['schemaVersion', 'receiptType', 'paper', 'blocks']);
const ALLOWED_PAPER = new Set(['rollWidthMm', 'printableWidthMm', 'heightMode', 'minHeightMm']);
const ALLOWED_BLOCK = new Set(['id', 'kind', 'enabled', 'style', 'text', 'assetId']);
const ALLOWED_STYLE = new Set(['fontSizePx', 'fontWeight', 'align', 'gapAfterMm', 'letterSpacingPx']);
const TYPES = new Set<string>(RECEIPT_BLOCK_KINDS);
const FONT_WEIGHTS = new Set([400, 600, 700, 800, 900]);
const ALIGNS = new Set(['left', 'center', 'right']);
const MAX_BLOCKS = 48;
const MAX_IMAGE_BLOCKS = 6;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function unexpectedKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, errors: string[]) {
  for (const k of Object.keys(value)) {
    if (!allowed.has(k)) errors.push(`${path}.${k}: unsupported property`);
  }
}

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

export type ReceiptTemplateValidation =
  | { ok: true; template: ReceiptTemplateV1; errors: [] }
  | { ok: false; template: null; errors: string[] };

/**
 * Structural validation only; server must additionally verify:
 * - session tenant/branch access and each asset's ownership + content,
 * - measured screenshot <= agent 576x4800 dots,
 * - published revision concurrency.
 */
export function validateReceiptTemplateV1(input: unknown): ReceiptTemplateValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, template: null, errors: ['template: expected object'] };
  unexpectedKeys(input, ALLOWED_ROOT, 'template', errors);
  if (input.schemaVersion !== 1) errors.push('schemaVersion: expected 1');
  if (input.receiptType !== 'invoice') errors.push('receiptType: only invoice is supported in v1');

  const paper = input.paper;
  if (!isRecord(paper)) {
    errors.push('paper: expected object');
  } else {
    unexpectedKeys(paper, ALLOWED_PAPER, 'paper', errors);
    if (paper.rollWidthMm !== 80 || paper.printableWidthMm !== 72) errors.push('paper: XP-80 requires 80mm roll / 72mm printable');
    if (paper.heightMode !== 'auto') errors.push('paper.heightMode: must be auto');
    if (paper.minHeightMm !== undefined && !inRange(paper.minHeightMm, 0, 260)) {
      errors.push('paper.minHeightMm: expected 0..260');
    }
  }

  const blocks = input.blocks;
  if (!Array.isArray(blocks) || blocks.length < 2 || blocks.length > MAX_BLOCKS) {
    errors.push(`blocks: expected 2..${MAX_BLOCKS} items`);
  } else {
    const ids = new Set<string>();
    let images = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b: unknown = blocks[i];
      const where = `blocks[${i}]`;
      if (!isRecord(b)) { errors.push(`${where}: expected object`); continue; }
      unexpectedKeys(b, ALLOWED_BLOCK, where, errors);
      if (typeof b.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(b.id)) {
        errors.push(`${where}.id: invalid identifier`);
      } else if (ids.has(b.id)) {
        errors.push(`${where}.id: duplicate identifier`);
      } else {
        ids.add(b.id);
      }
      if (typeof b.kind !== 'string' || !TYPES.has(b.kind)) errors.push(`${where}.kind: unsupported block`);
      if (typeof b.enabled !== 'boolean') errors.push(`${where}.enabled: expected boolean`);
      if (b.kind === 'image') {
        images++;
        if (typeof b.assetId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(b.assetId)) {
          errors.push(`${where}.assetId: invalid asset identifier`);
        }
      } else if (b.assetId !== undefined) {
        errors.push(`${where}.assetId: only image blocks may refer to an asset`);
      }
      if (b.kind === 'text') {
        if (typeof b.text !== 'string' || b.text.length > 180) errors.push(`${where}.text: expected text (up to 180 chars)`);
      } else if (b.text !== undefined) {
        errors.push(`${where}.text: only static text blocks may contain text`);
      }
      if (b.style !== undefined) {
        if (!isRecord(b.style)) {
          errors.push(`${where}.style: expected object`);
        } else {
          unexpectedKeys(b.style, ALLOWED_STYLE, `${where}.style`, errors);
          if (b.style.fontSizePx !== undefined && !inRange(b.style.fontSizePx, 9, 30)) errors.push(`${where}.style.fontSizePx: expected 9..30`);
          if (b.style.fontWeight !== undefined && !FONT_WEIGHTS.has(b.style.fontWeight as number)) errors.push(`${where}.style.fontWeight: unsupported`);
          if (b.style.align !== undefined && !ALIGNS.has(b.style.align as string)) errors.push(`${where}.style.align: unsupported`);
          if (b.style.gapAfterMm !== undefined && !inRange(b.style.gapAfterMm, 0, 8)) errors.push(`${where}.style.gapAfterMm: expected 0..8`);
          if (b.style.letterSpacingPx !== undefined && !inRange(b.style.letterSpacingPx, 0, 5)) errors.push(`${where}.style.letterSpacingPx: expected 0..5`);
        }
      }
    }
    if (images > MAX_IMAGE_BLOCKS) errors.push(`blocks: maximum ${MAX_IMAGE_BLOCKS} images`);
    const all = blocks.filter(isRecord);
    for (const kind of ['items', 'totals'] as const) {
      const mandatory = all.filter((b) => b.kind === kind);
      if (mandatory.length !== 1 || mandatory[0].enabled !== true) errors.push(`blocks: exactly one enabled ${kind} block is required`);
    }
    const itemsPos = blocks.findIndex((b) => isRecord(b) && b.kind === 'items');
    const totalsPos = blocks.findIndex((b) => isRecord(b) && b.kind === 'totals');
    if (itemsPos >= 0 && totalsPos >= 0 && itemsPos > totalsPos) errors.push('blocks: totals must follow items');
  }
  return errors.length === 0
    ? { ok: true, template: input as unknown as ReceiptTemplateV1, errors: [] }
    : { ok: false, template: null, errors };
}
