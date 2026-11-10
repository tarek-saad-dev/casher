import {
  DEFAULT_RECEIPT_FIELDS, validateReceiptTemplateV1,
  type ReceiptTemplateV1, type ReceiptBlockV1, type ReceiptField,
} from './template';

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
const money = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('en-US', {
  maximumFractionDigits: 2, minimumFractionDigits: 2,
});
function cssStyle(block: ReceiptBlockV1): string {
  const size = block.style?.fontSizePx ?? 12;
  const align = block.style?.align ?? 'left';
  const weight = block.style?.fontWeight ?? 600;
  const gap = block.style?.gapAfterMm ?? 1;
  const letter = block.style?.letterSpacingPx ?? 0;
  return `font-size:${size}px;text-align:${align};font-weight:${weight};margin-bottom:${gap}mm;letter-spacing:${letter}px;`;
}
function label(block: ReceiptBlockV1, field: ReceiptField, defaultValue?: string) {
  return escapeReceiptHtml(block.fields?.[field] ?? defaultValue ?? DEFAULT_RECEIPT_FIELDS[field]);
}
/** Renders a validated tree, with financial fields always populated by the sale data. */
export function renderStudioReceiptHtml(
  template: ReceiptTemplateV1, model: StudioInvoiceModel, assets: Record<string, string> = {},
): string {
  const validated = validateReceiptTemplateV1(template);
  if (!validated.ok) throw new Error('Unsafe receipt template: ' + validated.errors[0]);
  const safe = escapeReceiptHtml;
  const render = (blocks: ReceiptBlockV1[]): string => blocks.filter((b) => b.enabled).map((b) => {
    const style = cssStyle(b);
    const marker = 'data-block-id="' + b.id + '"';
    const editable = (key: ReceiptField, fallback?: string) => '<span data-edit-field="' + key + '">' + label(b, key, fallback) + '</span>';

    if (b.kind === 'group') {
      const padding = b.style?.paddingMm ?? 0;
      const spacing = b.style?.groupGapMm ?? 0;
      return `<section class="studio-block studio-group" ${marker} style="${style}padding:${padding}mm;row-gap:${spacing}mm">
        ${render(b.children ?? [])}
      </section>`;
    }
    if (b.kind === 'brand') return `<section class="studio-block brand" ${marker} style="${style}">
      <strong>${editable('brandName', model.brand)}</strong>
      <div class="brand-caption">${editable('brandTagline')}</div>
      <div class="brand-branch">${safe(model.branch)}</div>
    </section>`;
    if (b.kind === 'invoice-meta') return `<section class="studio-block meta" ${marker} style="${style}">
      <div class="pair"><b>${editable('receiptLabel')} #${safe(model.invoiceNo)}</b><span>${safe(model.date)}</span></div>
      <div class="pair"><span>${editable('customerLabel')}: ${safe(model.customer)}</span><span>${safe(model.time)}</span></div>
    </section>`;
    if (b.kind === 'items') {
      const rows = model.items.map((item, index) => `<tr><td>${index + 1}</td>
        <td class="item-name"><b>${safe(item.name)}</b>
        ${item.sublabel ? `<small>${safe(item.sublabel)}</small>` : ''}
        ${item.employee ? `<small>${safe(item.employee)}</small>` : ''}
        </td><td class="item-price">${item.price != null ? money(item.price) : ''}</td></tr>`).join('');
      return `<section class="studio-block items" ${marker} style="${style}">
        <table><colgroup><col style="width:24px"><col><col style="width:72px"></colgroup>
          <thead><tr>
            <th>${editable('numberHeader')}</th>
            <th>${editable('serviceHeader')}</th>
            <th>${editable('priceHeader')}</th>
          </tr></thead><tbody>${rows}</tbody></table></section>`;
    }
    if (b.kind === 'totals') {
      const discounts = model.discounts.filter((d) => d.amount > 0)
        .map((d) => `<div class="pair line"><span>${editable('discountLabel')}: ${safe(d.label)}</span><span>-${money(d.amount)} EGP</span></div>`).join('');
      return `<section class="studio-block totals" ${marker} style="${style}">
        <div class="pair line"><span>${editable('subtotalLabel')}</span><span>${money(model.subtotal)} EGP</span></div>
        ${discounts}
        <div class="pair grand"><strong>${editable('totalLabel')}</strong><strong>${money(model.grandTotal)} EGP</strong></div>
      </section>`;
    }
    if (b.kind === 'payment') return `<section class="studio-block payment" ${marker} style="${style}">
      ${model.payments.map((p) => `<div class="pair"><span>${editable('paymentLabel')}: ${safe(p.label)}</span>
        ${p.amount == null ? '' : `<span>${money(p.amount)} EGP</span>`}</div>`).join('')}
      </section>`;
    if (b.kind === 'divider') return `<div class="studio-block divider" ${marker} style="${style}"></div>`;
    if (b.kind === 'text') return `<section class="studio-block custom" ${marker} style="${style}"><span data-text-node>${safe(b.text)}</span></section>`;
    if (b.kind === 'image') {
      const src = b.assetId && assets[b.assetId];
      if (!src || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(src)) return '';
      const width = b.style?.imageWidthMm ?? 36;
      return `<section class="studio-block image" ${marker} style="${style}">
        <img src="${src}" style="width:${width}mm" alt="" />
      </section>`;
    }
    if (b.kind === 'footer') return `<section class="studio-block footer" ${marker} style="${style}">
      <strong>${editable('thanksText', model.footer || undefined)}</strong>
      <small>${editable('footerTagline')}</small>
      ${model.phone ? `<span>${safe(model.phone)}</span>` : ''}
    </section>`;
    return '';
  }).join('');
  return `<!doctype html><html lang="ar" dir="ltr"><head><meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Receipt Studio</title><style>
    *{box-sizing:border-box}
    html,body{width:72mm;max-width:72mm;margin:0;padding:0;background:#fff;color:#111;overflow:hidden}
    body{font-family:Arial,Tahoma,sans-serif;direction:ltr;font-size:12px;line-height:1.35;
      min-height:${template.paper.minHeightMm ?? 0}mm;padding:3mm 2.5mm 2.5mm}
    .studio-block{min-width:0;overflow-wrap:anywhere;cursor:pointer}
    [data-edit-field],[data-text-node]{cursor:text}
    [contenteditable="true"]{outline:1px dashed #555;white-space:pre-wrap}
    .studio-group{display:flex;flex-direction:column;min-width:0}
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
    .footer small,.footer span{display:block;font-size:9px}
    .custom{white-space:pre-wrap}
    .image img{display:inline-block;max-width:100%;max-height:28mm;height:auto;object-fit:contain;filter:grayscale(1) contrast(2)}
    @media print{html,body{margin:0;background:white;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    </style></head><body>${render(template.blocks)}</body></html>`;
}
