import {
  validateReceiptTemplateV1, type ReceiptBlockV1, type ReceiptTemplateV1,
} from './template';

/**
 * Pure tree editing. A failed move/group never mutates the original tree.
 * Nested groups always flow vertically (no absolute positioning or overlaps).
 */
export type TreePlacement = 'before' | 'inside';

export function findReceiptNode(blocks: ReceiptBlockV1[], id: string): ReceiptBlockV1 | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    const found = b.children ? findReceiptNode(b.children, id) : null;
    if (found) return found;
  }
  return null;
}
export function allReceiptNodes(blocks: ReceiptBlockV1[]): ReceiptBlockV1[] {
  return blocks.flatMap((b) => [b, ...allReceiptNodes(b.children ?? [])]);
}
export function treeNodeParentId(blocks: ReceiptBlockV1[], id: string, parentId: string | null = null): string | null | undefined {
  for (const b of blocks) {
    if (b.id === id) return parentId;
    if (b.children) {
      const found = treeNodeParentId(b.children, id, b.id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
function withChildren(blocks: ReceiptBlockV1[], id: string, transform: (node: ReceiptBlockV1) => ReceiptBlockV1): ReceiptBlockV1[] {
  return blocks.map((b) => {
    if (b.id === id) return transform(b);
    return b.children ? { ...b, children: withChildren(b.children, id, transform) } : b;
  });
}
function removeRec(blocks: ReceiptBlockV1[], id: string): { blocks: ReceiptBlockV1[]; removed: ReceiptBlockV1 | null } {
  let removed: ReceiptBlockV1 | null = null;
  const next: ReceiptBlockV1[] = [];
  for (const b of blocks) {
    if (b.id === id) { removed = b; continue; }
    if (b.children) {
      const result = removeRec(b.children, id);
      if (result.removed) removed = result.removed;
      next.push({ ...b, children: result.blocks });
    } else next.push(b);
  }
  return { blocks: next, removed };
}
function insertBefore(blocks: ReceiptBlockV1[], targetId: string, value: ReceiptBlockV1): ReceiptBlockV1[] {
  const output: ReceiptBlockV1[] = [];
  for (const b of blocks) {
    if (b.id === targetId) output.push(value);
    output.push(b.children ? { ...b, children: insertBefore(b.children, targetId, value) } : b);
  }
  return output;
}
function verified(template: ReceiptTemplateV1, candidate: ReceiptBlockV1[]): ReceiptTemplateV1 {
  const result = { ...template, blocks: candidate };
  return validateReceiptTemplateV1(result).ok ? result : template;
}
export function updateTreeNode(
  template: ReceiptTemplateV1, id: string,
  patch: Partial<ReceiptBlockV1>,
): ReceiptTemplateV1 {
  const original = findReceiptNode(template.blocks, id);
  if (!original || (original.locked && !(patch.locked === false && Object.keys(patch).length === 1))) return template;
  // A caller must never move children via an unchecked patch.
  if (patch.children !== undefined || patch.id !== undefined || patch.kind !== undefined) return template;
  const tree = withChildren(template.blocks, id, (b) => ({
    ...b, ...patch, style: patch.style ? { ...b.style, ...patch.style } : b.style,
    fields: patch.fields ? { ...b.fields, ...patch.fields } : b.fields,
  }));
  return verified(template, tree);
}
export function moveTreeNode(
  template: ReceiptTemplateV1, sourceId: string, targetId: string, placement: TreePlacement = 'before',
): ReceiptTemplateV1 {
  if (sourceId === targetId) return template;
  const source = findReceiptNode(template.blocks, sourceId);
  const target = findReceiptNode(template.blocks, targetId);
  if (!source || !target || source.locked || target.locked) return template;
  if (allReceiptNodes(source.children ?? []).some((x) => x.id === targetId)) return template;
  if (placement === 'inside' && target.kind !== 'group') return template;
  const without = removeRec(template.blocks, sourceId);
  if (!without.removed) return template;
  const tree = placement === 'inside'
    ? withChildren(without.blocks, targetId, (b) => ({ ...b, children: [...(b.children ?? []), source] }))
    : insertBefore(without.blocks, targetId, source);
  return verified(template, tree);
}

function newUniqueId(blocks: ReceiptBlockV1[], prefix: string): string {
  const seen = new Set(allReceiptNodes(blocks).map((b) => b.id));
  let index = 1;
  while (seen.has(`${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}
export function addTreeNode(
  template: ReceiptTemplateV1,
  kind: 'text' | 'divider' | 'group' | 'image',
  parentId: string | null = null,
  assetId?: string,
): ReceiptTemplateV1 {
  if (kind === 'image' && (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId))) return template;
  const parent = parentId ? findReceiptNode(template.blocks, parentId) : null;
  if (parentId && (parent?.kind !== 'group' || parent.locked)) return template;
  const node: ReceiptBlockV1 = {
    id: newUniqueId(template.blocks, kind),
    name: kind === 'group' ? 'New Group' : undefined,
    kind, enabled: true,
    ...(kind === 'text' ? { text: 'Your text here' } : {}),
    ...(kind === 'group' ? { children: [], style: { paddingMm: 1, groupGapMm: 1 } } : {}),
    ...(kind === 'image' ? { assetId, style: { imageWidthMm: 36, align: 'center', gapAfterMm: 1 } } : {}),
  };
  const blocks = parentId
    ? withChildren(template.blocks, parentId, (p) => ({ ...p, children: [...(p.children ?? []), node] }))
    : [...template.blocks, node];
  return verified(template, blocks);
}

export function removeTreeNode(template: ReceiptTemplateV1, id: string): ReceiptTemplateV1 {
  const node = findReceiptNode(template.blocks, id);
  if (!node || node.locked || ['items', 'totals'].includes(node.kind)) return template;
  // Never silently delete mandatory descendants (the validator also rejects that).
  return verified(template, removeRec(template.blocks, id).blocks);
}
export function groupReceiptNodes(template: ReceiptTemplateV1, selectedIds: string[]): ReceiptTemplateV1 {
  const selected = [...new Set(selectedIds)];
  if (selected.length < 2) return template;
  const parentId = treeNodeParentId(template.blocks, selected[0]);
  if (parentId === undefined) return template;
  if (selected.some((id) => treeNodeParentId(template.blocks, id) !== parentId)) return template;
  const siblings = parentId === null ? template.blocks : findReceiptNode(template.blocks, parentId)?.children;
  if (!siblings) return template;
  const picked = siblings.filter((b) => selected.includes(b.id));
  if (picked.length !== selected.length || picked.some((b) => b.locked)) return template;
  const group: ReceiptBlockV1 = {
    id: newUniqueId(template.blocks, 'group'), kind: 'group', name: 'New Group',
    enabled: true, style: { paddingMm: 1, groupGapMm: 1 },
    children: picked,
  };
  let placed = false;
  const replacement = siblings.flatMap((b) => {
    if (!selected.includes(b.id)) return [b];
    if (placed) return [];
    placed = true;
    return [group];
  });
  const blocks = parentId === null ? replacement :
    withChildren(template.blocks, parentId, (p) => ({ ...p, children: replacement }));
  return verified(template, blocks);
}
export function ungroupReceiptNode(template: ReceiptTemplateV1, id: string): ReceiptTemplateV1 {
  const node = findReceiptNode(template.blocks, id);
  if (!node || node.kind !== 'group' || node.locked) return template;
  const visit = (blocks: ReceiptBlockV1[]): ReceiptBlockV1[] => blocks.flatMap((b) => {
    if (b.id === id) return b.children ?? [];
    return [b.children ? { ...b, children: visit(b.children) } : b];
  });
  return verified(template, visit(template.blocks));
}
export function duplicateTreeNode(template: ReceiptTemplateV1, id: string): ReceiptTemplateV1 {
  const node = findReceiptNode(template.blocks, id);
  if (!node || node.locked || !['text', 'image', 'divider'].includes(node.kind)) return template;
  const duplicate: ReceiptBlockV1 = { ...structuredClone(node), id: newUniqueId(template.blocks, node.kind) };
  // Insert before original, can subsequently reorder.
  return verified(template, insertBefore(template.blocks, id, duplicate));
}
