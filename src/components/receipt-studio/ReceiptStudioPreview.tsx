'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSampleReceipt, type SampleScenario } from '@/lib/receipt-studio/editor';
import { renderStudioReceiptHtml, type StudioInvoiceModel } from '@/lib/receipt-studio/render';
import type { ReceiptField, ReceiptTemplateV1 } from '@/lib/receipt-studio/template';

type Props = {
  template: ReceiptTemplateV1;
  scenario: SampleScenario;
  selectedId: string | null;
  selectedIds?: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onEditText?: (id: string, text: string) => void;
  onEditField?: (id: string, field: ReceiptField, text: string) => void;
  onHeight: (millimeters: number) => void;
  assets?: Record<string, string>;
};

function invoiceFixture(scenario: SampleScenario): StudioInvoiceModel {
  const d = getSampleReceipt(scenario);
  return {
    invoiceNo: d.invoiceNo.replace('#', ''),
    date: d.date, time: d.time, branch: d.branch,
    brand: 'CUT SALON', customer: d.customer,
    items: d.items.map((item) => ({ name: item.name, price: item.price * item.qty })),
    subtotal: d.subtotal,
    discounts: d.discount > 0 ? [{ label: 'Discount', amount: d.discount }] : [],
    grandTotal: d.total, payments: [{ label: d.payment }],
    footer: 'شكراً لزيارتكم',
  };
}

/**
 * The canvas IS the production HTML renderer (not a second approximation).
 * The sandbox disables scripts; the parent listens for selections/double clicks
 * on the same-origin srcDoc. Real invoice fields never become contentEditable.
 */
export default function ReceiptStudioPreview({
  template, scenario, selectedId, selectedIds = [],
  onSelect, onEditText, onEditField, onHeight, assets = {},
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cleanupRef = useRef<() => void>(() => {});
  const callbacks = useRef({ onSelect, onEditText, onEditField, onHeight });
  callbacks.current = { onSelect, onEditText, onEditField, onHeight };
  const [height, setHeight] = useState(390);
  const html = useMemo(
    () => renderStudioReceiptHtml(template, invoiceFixture(scenario), assets),
    [template, scenario, assets],
  );

  const install = () => {
    cleanupRef.current();
    const frame = iframeRef.current;
    const doc = frame?.contentDocument;
    if (!doc?.body) return;
    let disposed = false;

    const measure = () => {
      if (disposed) return;
      const pixels = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 40);
      setHeight((before) => before === pixels ? before : pixels);
      callbacks.current.onHeight(Math.ceil(pixels / (96 / 25.4)));
    };
    const highlight = () => {
      const selected = new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : []);
      doc.querySelectorAll<HTMLElement>('[data-block-id]').forEach((el) => {
        const active = selected.has(el.dataset.blockId ?? '');
        el.style.outline = active ? '2px solid #0ea5e9' : '';
        el.style.outlineOffset = active ? '2px' : '';
      });
    };

    const selectedBlock = (target: EventTarget | null) => {
      return target instanceof doc.defaultView!.Element
        ? (target as Element).closest<HTMLElement>('[data-block-id]') : null;
    };
    const onClick = (event: MouseEvent) => {
      const el = selectedBlock(event.target);
      if (el?.dataset.blockId) callbacks.current.onSelect(el.dataset.blockId, event.shiftKey || event.ctrlKey || event.metaKey);
    };
    const onDblClick = (event: MouseEvent) => {
      const block = selectedBlock(event.target);
      if (!block?.dataset.blockId) return;
      const target = event.target;
      if (!(target instanceof doc.defaultView!.Element)) return;
      const editable = (target as Element).closest<HTMLElement>('[data-edit-field], [data-text-node]');
      if (!editable) return;
      event.preventDefault();
      event.stopPropagation();
      const field = editable.dataset.editField as ReceiptField | undefined;
      const isTextNode = editable.hasAttribute('data-text-node');
      if (!isTextNode && !field) return;
      const original = editable.textContent ?? '';
      editable.contentEditable = 'true';
      editable.spellcheck = false;
      editable.focus();
      const range = doc.createRange();
      range.selectNodeContents(editable);
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      let canceled = false;
      const keyDown = (key: KeyboardEvent) => {
        if (key.key === 'Escape') {
          canceled = true;
          editable.textContent = original;
          editable.blur();
        }
        if (key.key === 'Enter') {
          key.preventDefault();
          editable.blur();
        }
      };
      const blur = () => {
        editable.removeEventListener('keydown', keyDown);
        editable.removeEventListener('blur', blur);
        editable.contentEditable = 'false';
        if (canceled) return;
        const value = (editable.textContent ?? '').trim();
        if (value === original) return;
        if (isTextNode) callbacks.current.onEditText?.(block.dataset.blockId!, value.slice(0, 500));
        else if (field) callbacks.current.onEditField?.(block.dataset.blockId!, field, value.slice(0, 90));
      };
      editable.addEventListener('keydown', keyDown);
      editable.addEventListener('blur', blur);
    };
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(doc.body);
    doc.addEventListener('click', onClick);
    doc.addEventListener('dblclick', onDblClick);
    doc.addEventListener('load', measure, true);
    highlight();
    measure();
    cleanupRef.current = () => {
      disposed = true;
      resizeObserver.disconnect();
      doc.removeEventListener('click', onClick);
      doc.removeEventListener('dblclick', onDblClick);
      doc.removeEventListener('load', measure, true);
    };
  };

  useEffect(() => () => cleanupRef.current(), []);
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const selected = new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : []);
    doc.querySelectorAll<HTMLElement>('[data-block-id]').forEach((el) => {
      const active = selected.has(el.dataset.blockId ?? '');
      el.style.outline = active ? '2px solid #0ea5e9' : '';
      el.style.outlineOffset = active ? '2px' : '';
    });
  }, [selectedId, selectedIds]);

  return (
    <iframe
      ref={iframeRef}
      title="CUT Salon · live receipt design"
      sandbox="allow-same-origin"
      srcDoc={html}
      onLoad={install}
      className="block border-none bg-white"
      style={{ width: '72mm', height: `${height}px`, maxWidth: '72mm' }}
    />
  );
}
