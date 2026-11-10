'use client';

import { useEffect, useRef } from 'react';
import type { ReceiptBlockV1, ReceiptTemplateV1 } from '@/lib/receipt-studio/template';
import { formatMoney, getSampleReceipt, type SampleScenario } from '@/lib/receipt-studio/editor';

type Props = {
  template: ReceiptTemplateV1;
  scenario: SampleScenario;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHeight: (millimeters: number) => void;
  assets?: Record<string, string>;
};

function blockStyle(block: ReceiptBlockV1): React.CSSProperties {
  return {
    textAlign: block.style?.align ?? 'left',
    fontSize: block.style?.fontSizePx ?? 12,
    fontWeight: block.style?.fontWeight ?? 600,
    letterSpacing: block.style?.letterSpacingPx ?? 0,
    marginBottom: `${block.style?.gapAfterMm ?? 1}mm`,
  };
}

export default function ReceiptStudioPreview({
  template, scenario, selectedId, onSelect, onHeight, assets = {},
}: Props) {
  const receipt = getSampleReceipt(scenario);
  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = receiptRef.current;
    if (!element) return;
    const measure = () => {
      const h = element.offsetHeight;
      onHeight(Math.round(h / (96 / 25.4)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [template, scenario, onHeight]);

  function renderBlock(block: ReceiptBlockV1) {
    const styles = blockStyle(block);
    if (block.kind === 'brand') {
      return (
        <div style={{ ...styles, textAlign: 'center' }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: styles.fontSize, fontWeight: 900, lineHeight: 0.95, letterSpacing: '-2px' }}>CUT</div>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '5px', paddingLeft: 5, marginTop: 4 }}>SALON</div>
          <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '2px', marginTop: 4 }}>MEN&apos;S GROOMING CLUB</div>
        </div>
      );
    }
    if (block.kind === 'invoice-meta') {
      return (
        <div style={{ ...styles, padding: '7px 0', borderTop: '1px solid #242424', borderBottom: '1px solid #d8d8d8', lineHeight: 1.55 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>RECEIPT {receipt.invoiceNo}</b><span>{receipt.branch}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, fontWeight: 500 }}><span>{receipt.date}</span><span>{receipt.time}</span></div>
          <div style={{ fontSize: 11, fontWeight: 500 }}>Customer: {receipt.customer}</div>
        </div>
      );
    }
    if (block.kind === 'items') {
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', ...styles, textAlign: 'left', direction: 'ltr' }}>
          <colgroup><col style={{ width: 24 }}/><col/><col style={{ width: 68 }}/></colgroup>
          <thead><tr style={{ background: '#171717', color: '#fff', fontSize: 11 }}>
            <th style={{ padding: '7px 4px', textAlign: 'center' }}>NO.</th>
            <th style={{ padding: '7px 5px' }}>SERVICE</th>
            <th style={{ padding: '7px 5px', textAlign: 'right' }}>PRICE</th>
          </tr></thead>
          <tbody>
            {receipt.items.map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px dashed #c6c6c6', verticalAlign: 'top' }}>
                <td style={{ padding: '6px 4px', fontSize: 11, textAlign: 'center' }}>{i + 1}</td>
                <td style={{ padding: '6px 5px', overflowWrap: 'anywhere', lineHeight: 1.35 }}>{item.name}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMoney(item.price * item.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (block.kind === 'totals') {
      return (
        <div style={{ ...styles, textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 500, padding: '3px 2px' }}>
            <span>Subtotal</span><span>{formatMoney(receipt.subtotal)} EGP</span>
          </div>
          {receipt.discount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 500, padding: '2px 2px 6px' }}>
              <span>Discount</span><span>-{formatMoney(receipt.discount)} EGP</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111', color: '#fff', padding: '9px 10px', borderRadius: 3, fontSize: 14, fontWeight: 900 }}>
            <span>TOTAL</span><span style={{ fontSize: styles.fontSize, whiteSpace: 'nowrap' }}>{formatMoney(receipt.total)} EGP</span>
          </div>
        </div>
      );
    }
    if (block.kind === 'payment') {
      return (
        <div style={{ ...styles, display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #aaa', paddingBottom: 6, fontSize: 11 }}>
          <span>Payment Method</span><strong>{receipt.payment}</strong>
        </div>
      );
    }
    if (block.kind === 'footer') {
      return (
        <div style={{ ...styles, textAlign: 'center', lineHeight: 1.5 }}>
          <div style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: 13 }}>شكراً لزيارتكم</div>
          <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: 1 }}>MORE THAN A HAIRCUT</div>
        </div>
      );
    }
    if (block.kind === 'divider') {
      return <div style={{ ...styles, height: 1, borderBottom: '1px dashed #777' }} />;
    }
    if (block.kind === 'text') {
      return <div style={{ ...styles, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{block.text}</div>;
    }
    const src = block.assetId ? assets[block.assetId] : null;
    return src ? (
      <div style={{ ...styles, textAlign: 'center' }}>
        <img src={src} alt="Uploaded receipt decoration" style={{ display: 'block', maxWidth: '100%', maxHeight: '28mm', width: 'auto', margin: '0 auto', filter: 'grayscale(1) contrast(2)' }} />
      </div>
    ) : <div style={{ ...styles, fontSize: 10, border: '1px dashed #999', padding: 8 }}>صورة غير متاحة</div>;
  }

  return (
    <div
      ref={receiptRef}
      data-testid="receipt-studio-paper"
      className="relative overflow-hidden bg-white text-black"
      style={{
        width: '72mm', minWidth: '72mm', maxWidth: '72mm',
        minHeight: `${template.paper.minHeightMm ?? 0}mm`,
        padding: '3.5mm 3mm 3mm', boxSizing: 'border-box',
        fontFamily: 'Arial, Tahoma, sans-serif', direction: 'ltr',
      }}
    >
      {template.blocks.filter((b) => b.enabled).map((block) => (
        <div
          key={block.id}
          role="button"
          tabIndex={0}
          aria-label={`تعديل عنصر ${block.kind}`}
          onClick={() => onSelect(block.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(block.id); }
          }}
          className={`relative cursor-pointer rounded-[2px] outline outline-2 outline-offset-[2px] transition-colors hover:outline-slate-400 ${selectedId === block.id ? 'outline-sky-500' : 'outline-transparent'}`}
        >
          {renderBlock(block)}
        </div>
      ))}
    </div>
  );
}
