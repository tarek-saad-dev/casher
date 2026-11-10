'use client';

import { useState, type DragEvent, type MouseEvent } from 'react';
import {
  ChevronDown, ChevronLeft, Copy, Eye, EyeOff, Folder,
  GripVertical, Lock, Unlock, Type, Image as ImageIcon, Minus,
  ReceiptText, CreditCard, Scissors,
} from 'lucide-react';
import type { ReceiptBlockV1 } from '@/lib/receipt-studio/template';
import type { TreePlacement } from '@/lib/receipt-studio/tree';

const icons = {
  group: Folder, text: Type, image: ImageIcon, divider: Minus,
  brand: Scissors, 'invoice-meta': ReceiptText, items: ReceiptText,
  totals: ReceiptText, payment: CreditCard, footer: Type,
};

const titles = {
  group: 'Group', text: 'Text', image: 'PNG Image', divider: 'Divider',
  brand: 'Brand', 'invoice-meta': 'Invoice Info', items: 'Services',
  totals: 'Totals', payment: 'Payment', footer: 'Footer',
};

export type ReceiptStudioLayerTreeProps = {
  nodes: ReceiptBlockV1[];
  selectedIds: string[];
  draggingId: string | null;
  onSelect: (id: string, additive: boolean) => void;
  onMove: (source: string, target: string, placement: TreePlacement) => void;
  onDrag: (id: string | null) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onLock: (id: string, locked: boolean) => void;
  onDuplicate: (id: string) => void;
};

export default function ReceiptStudioLayerTree({
  nodes, selectedIds, draggingId, onSelect, onMove, onDrag,
  onToggle, onLock, onDuplicate,
}: ReceiptStudioLayerTreeProps) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const toggleCollapse = (id: string) =>
    setCollapsed((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);
  const onDragStart = (event: DragEvent<HTMLDivElement>, id: string) => {
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    onDrag(id);
  };
  const drop = (event: DragEvent, id: string, placement: TreePlacement) => {
    event.preventDefault();
    event.stopPropagation();
    const idToMove = event.dataTransfer.getData('text/plain') || draggingId;
    if (idToMove && idToMove !== id) onMove(idToMove, id, placement);
    onDrag(null);
  };
  const onClick = (event: MouseEvent, id: string) => onSelect(id, event.ctrlKey || event.metaKey || event.shiftKey);

  const render = (items: ReceiptBlockV1[], depth: number) => items.map((block) => {
    const Icon = icons[block.kind];
    const chosen = selectedIds.includes(block.id);
    const isGroup = block.kind === 'group';
    const expanded = !collapsed.includes(block.id);
    const required = block.kind === 'items' || block.kind === 'totals';
    return (
      <div key={block.id} className="min-w-0">
        <div
          draggable={!block.locked}
          onDragStart={(event) => onDragStart(event, block.id)}
          onDragEnd={() => onDrag(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => drop(event, block.id, 'before')}
          className={`group/layer mb-1 flex min-w-0 items-center gap-1 rounded-lg border py-1.5 pl-1 pr-1.5
            ${chosen ? 'border-sky-500/60 bg-sky-500/10' : 'border-transparent hover:border-border hover:bg-muted/60'}
            ${block.enabled ? '' : 'opacity-45'}
            ${draggingId === block.id ? 'opacity-30' : ''}`}
          style={{ paddingRight: 5 + depth * 13 }}
        >
          {isGroup ? (
            <button type="button" onClick={() => toggleCollapse(block.id)} aria-label={expanded ? 'طي المجموعة' : 'فتح المجموعة'}
              className="rounded p-0.5 hover:bg-muted">
              {expanded ? <ChevronDown className="size-3.5"/> : <ChevronLeft className="size-3.5"/>}
            </button>
          ) : <GripVertical aria-hidden className="size-3.5 shrink-0 cursor-grab text-muted-foreground"/>}
          <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground"/>
          <button
            type="button" className="min-w-0 flex-1 truncate text-right text-xs font-medium"
            title={block.name || titles[block.kind]}
            onClick={(event) => onClick(event, block.id)}
          >
            {block.name || titles[block.kind]}
          </button>
          <button type="button" disabled={required || block.locked} title={block.enabled ? 'إخفاء' : 'إظهار'}
            aria-label={`${block.enabled ? 'إخفاء' : 'إظهار'} ${block.name || titles[block.kind]}`}
            onClick={() => onToggle(block.id, !block.enabled)}
            className="rounded p-0.5 hover:bg-muted disabled:opacity-25">
            {block.enabled ? <Eye className="size-3.5"/> : <EyeOff className="size-3.5"/>}
          </button>
          <button type="button" title={block.locked ? 'فك القفل' : 'قفل العنصر'}
            aria-label={block.locked ? 'فك القفل' : 'قفل العنصر'}
            onClick={() => onLock(block.id, !block.locked)}
            className="rounded p-0.5 hover:bg-muted">
            {block.locked ? <Lock className="size-3.5"/> : <Unlock className="size-3.5"/>}
          </button>
          {['text', 'image', 'divider'].includes(block.kind) && (
            <button type="button" title="نسخ العنصر" disabled={block.locked}
              onClick={() => onDuplicate(block.id)} className="rounded p-0.5 hover:bg-muted disabled:opacity-25">
              <Copy className="size-3.5"/>
            </button>
          )}
        </div>
        {isGroup && expanded && (
          <div className="mb-2">
            {render(block.children ?? [], depth + 1)}
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => drop(event, block.id, 'inside')}
              className={`rounded border border-dashed px-2 py-1 text-center text-[10px]
                ${draggingId ? 'border-sky-500/60 bg-sky-500/5 text-sky-600' : 'border-border/60 text-muted-foreground'}`}
              style={{ marginRight: (depth + 1) * 12 }}
              title="اسحب عنصرًا هنا لإدخاله داخل المجموعة"
            >
              اسحب هنا لإضافة عنصر داخل المجموعة
            </div>
          </div>
        )}
      </div>
    );
  });
  return <div role="tree" aria-label="Receipt Layers" className="max-h-[60vh] min-w-0 overflow-auto">{render(nodes, 0)}</div>;
}
