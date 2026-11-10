import { validateReceiptTemplateV1, type ReceiptTemplateV1, type ReceiptBlockV1 } from './template';

export type StudioInvoiceLine = {
  name: string;
  sublabel?: string;
  employee?: string;
  price: number | null;
};
export type StudioInvoiceModel = {
  invoiceNo: string; date: string; time: string;
  branch: string; brand: string; customer: string;
  phone?: string;
  items: StudioInvoiceLine[];
  subtotal: number; discounts: Array<{ label: string; amount: number }>;
  grandTotal: number; payments: Array<{ label: string; amount?: number }>;
  footer?: string;
};

export function escapeReceiptHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

const money = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function selectedStyle(block: ReceiptBlockV1) {
  const size = block.style?.fontSizePx ?? 12;
  const align = block.style?.align ?? 'left';
  const weight = block.style?.fontWeight ?? 600;
  const gap = block.style?.gapAfterMm ?? 1;
  const letter = block.style?.letterSpacingPx ?? 0;
  return `font-size:${size}px;text-align:${align};font-weight:${weight};margin-bottom:${gap}mm;letter-spacing:${letter}px;`;
}

/**
 * Generates a standalone, deterministic 72mm HTML receipt for both preview and
 * local Agent. Does not import server-only modules, never executes user CSS/HTML,
 * and never recalculates the sale's authoritative GrandTotal.
 */
export function renderStudioReceiptHtml(
  template: ReceiptTemplateV1, model: StudioInvoiceModel, assets: Record<string, string> = {},
): string {
  const checked = validateReceiptTemplateV1(template);
  if (!checked.ok) throw new Error('Unsafe receipt template: ' + checked.errors[0]);
  const safe = (x: unknown) => escapeReceiptHtml(x);
  const blocks = template.blocks.filter((b) => b.enabled).map((block) => {
    const style = selectedStyle(block);
    if (block.kind === 'brand') {
      return `<section class="studio-block brand" style="${style}">
        <strong>${safe(model.brand)}</strong>
        <div class="brand-caption">MEN'S GROOMING</div>
        <div class="brand-branch">${safe(model.branch)}</div>
      </section>`;
    }
    if (block.kind === 'invoice-meta') {
      return `<section class="studio-block meta" style="${style}">
        <div class="pair"><b>RECEIPT #${safe(model.invoiceNo)}</b><span>${safe(model.date)}</span></div>
        <div class="pair"><span>${safe(model.customer)}</span><span>${safe(model.time)}</span></div>
      </section>`;
    }
    if (block.kind === 'items') {
      const rows = model.items.map((item, index) => `<tr><td>${index + 1}</td>
        <td class="item-name"><b>${safe(item.name)}</b>
        ${item.sublabel ? `<small>${safe(item.sublabel)}</small>` : ''}
        ${item.employee ? `<small>${safe(item.employee)}</small>` : ''}
        </td><td class="item-price">${item.price != null ? money(item.price) : ''}</td></tr>`).join('');
      return `<section class="studio-block items" style="${style}">
      <table><colgroup><col style="width:24px"><col><col style="width:72px"></colgroup>
      <thead><tr><th>NO.</th><th>SERVICE</th><th>PRICE</th></tr></thead>
      <tbody>${rows}</tbody></table></section>`;
    }
    if (block.kind === 'totals') {
      const discounts = model.discounts.filter((d) => d.amount > 0)
        .map((d) => `<div class="pair line"><span>${safe(d.label)}</span><span>-${money(d.amount)} EGP</span></div>`).join('');
      return `<section class="studio-block totals" style="${style}">
        <div class="pair line"><span>Subtotal</span><span>${money(model.subtotal)} EGP</span></div>
        ${discounts}
        <div class="pair grand"><strong>TOTAL</strong><strong>${money(model.grandTotal)} EGP</strong></div>
      </section>`;
    }
    if (block.kind === 'payment') {
      return `<section class="studio-block payment" style="${style}">
      ${model.payments.map((p) => `<div class="pair"><span>Payment: ${safe(p.label)}</span>
      ${p.amount == null ? '' : `<span>${money(p.amount)} EGP</span>`}</div>`).join('')}
      </section>`;
    }
    if (block.kind === 'divider') return `<div class="studio-block divider" style="${style}"></div>`;
    if (block.kind === 'text') return `<section class="studio-block custom" style="${style}">${safe(block.text)}</section>`;
    if (block.kind === 'image') {
      const src = block.assetId && assets[block.assetId];
      if (!src || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(src)) return '';
      return `<section class="studio-block image" style="${style}"><img src="${src}" alt="" /></section>`;
    }
    if (block.kind === 'footer') {
      return `<section class="studio-block footer" style="${style}">
        <strong>${safe(model.footer || 'شكراً لزيارتكم')}</strong>
        ${model.phone ? `<span>${safe(model.phone)}</span>` : ''}
      </section>`;
    }
    return '';
  }).join('');
  return `<!doctype html><html lang="ar" dir="ltr"><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Receipt Studio</title><style>
  *{box-sizing:border-box}
  html,body{width:72mm;max-width:72mm;margin:0;padding:0;background:#fff;color:#111;overflow:hidden}
  body{font-family:Arial,Tahoma,sans-serif;direction:ltr;font-size:12px;line-height:1.35;
    min-height:${template.paper.minHeightMm ?? 0}mm;padding:3mm 2.5mm 2.5mm}
  .studio-block{min-width:0;overflow-wrap:anywhere}
  .brand{text-align:center;border-bottom:1px solid #111;padding-bottom:5px}
  .brand strong{font-size:inherit;font-family:Georgia,Arial,sans-serif;letter-spacing:-1.5px}
  .brand-caption{font-size:8px;letter-spacing:2px;font-weight:600}
  .brand-branch{font-size:9px;letter-spacing:0.7px;font-weight:600}
  .meta{font-size:11px!important;border-bottom:1px dashed #888;padding-bottom:5px}
  .pair{display:flex;gap:8px;justify-content:space-between;align-items:baseline;min-width:0}
  .pair>*{overflow-wrap:anywhere;min-width:0}
  table{border-collapse:collapse;width:100%;table-layout:fixed;text-align:left;direction:ltr;font-size:inherit}
  th{background:#161616;color:#fff;padding:6px 4px;font-size:11px}
  td{padding:5px 4px;vertical-align:top;border-bottom:1px dashed #bdbdbd}
  th:first-child,td:first-child{text-align:center}
  th:last-child,td:last-child{text-align:right}
  .item-name{overflow-wrap:anywhere}
  .item-name small{display:block;color:#444;font-size:9px;font-weight:400;line-height:1.3;margin-top:2px}
  .item-price{white-space:nowrap}
  .line{font-size:11px;font-weight:500;padding:2px 2px}
  .grand{background:#111;color:#fff;align-items:center;padding:9px 7px;border-radius:2px;margin-top:5px;font-weight:900}
  .grand strong{white-space:nowrap}
  .payment{font-size:11px!important;border-bottom:1px dashed #888;padding-bottom:5px}
  .divider{border-top:1px dashed #555}
  .footer{text-align:center;font-size:12px!important}
  .footer span{display:block;font-size:10px}
  .custom{white-space:pre-wrap}
  .image img{display:block;max-width:100%;width:auto;max-height:28mm;object-fit:contain;margin:0 auto;filter:grayscale(1) contrast(2)}
  @page{size:80mm 200mm;margin:0}
  @media print{html,body{margin:0;padding:0;background:white;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body>${blocks}</body></html>`;
}
