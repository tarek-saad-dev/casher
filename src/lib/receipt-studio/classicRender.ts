/**
 * CUT Classic editable renderer.
 * Uses the EXACT same original receipt CSS as the printed legacy invoice.
 * The master remains immutable in template.ts; only an explicit Studio draft
 * can change labels, visibility, ordering, or bounded style properties.
 */
import { CUT_CLASSIC_ORIGINAL_CSS } from './classicStyle';
import type {
  ReceiptTemplateV1, ReceiptBlockV1, ReceiptField,
} from './template';
import type { StudioInvoiceModel } from './render';

const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c] ?? c));

function style(b: ReceiptBlockV1): string {
  const s = b.style;
  if (!s) return '';
  return [
    s.fontSizePx === undefined ? '' : `font-size:${s.fontSizePx}px`,
    s.fontWeight === undefined ? '' : `font-weight:${s.fontWeight}`,
    s.align === undefined ? '' : `text-align:${s.align}`,
    s.letterSpacingPx === undefined ? '' : `letter-spacing:${s.letterSpacingPx}px`,
    s.gapAfterMm === undefined ? '' : `margin-bottom:${s.gapAfterMm}mm`,
  ].filter(Boolean).join(';');
}
function editable(b: ReceiptBlockV1, key: ReceiptField, fallback: string): string {
  const value = b.fields?.[key] ?? fallback;
  return `<span data-edit-field="${key}">${escape(value)}</span>`;
}

function printPayment(payments: StudioInvoiceModel['payments']): string {
  if (!payments.length) return 'غير محدد';
  if (payments.length === 1) return escape(payments[0].label);
  return payments.map(p =>
    `<span class="payment-line">${escape(p.label)}${p.amount === undefined ? '' : `: ${escape(p.amount.toFixed(2))} ج.م`}</span>`
  ).join(' + ');
}
function money(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

/** Input has already passed validateReceiptTemplateV1 in render.ts. */
export function renderCutClassicReceipt(
  template: ReceiptTemplateV1,
  model: StudioInvoiceModel,
  assets: Record<string, string>,
): string {
  const render = (blocks: ReceiptBlockV1[]): string => blocks.filter(b => b.enabled).map((b) => {
    const mark = `data-block-id="${b.id}"`;
    const inline = style(b) ? ` style="${style(b)}"` : '';

    if (b.kind === 'group') {
      const padding = b.style?.paddingMm ?? 0;
      const gap = b.style?.groupGapMm ?? 0;
      return `<section class="classic-edit-group" ${mark}${inline} style="padding:${padding}mm;row-gap:${gap}mm">${render(b.children ?? [])}</section>`;
    }
    if (b.kind === 'brand') {
      const title = b.fields?.brandName ?? model.brand;
      const wordmark = model.brandWordmark ?? title.trim().split(/\s+/)[0] ?? 'CUT';
      return `<div class="receipt-header" ${mark}${inline}>
        <div class="header-ornaments">
          <div class="barber-pole"></div>
          <div class="logo-circle">
            <div class="crown">👑</div>
            <div class="logo-text">${escape(wordmark)}</div>
            <div class="mustache">〰</div>
            <div class="scissors">✂</div>
          </div>
          <div class="barber-pole"></div>
        </div>
        <div class="salon-name-main">${editable(b, 'brandName', model.brand)}</div>
        <div class="salon-name-ar">${editable(b, 'brandTagline', model.branch)}</div>
        ${model.phone ? `<div class="salon-phone">📞 ${escape(model.phone)}</div>` : ''}
      </div>`;
    }
    if (b.kind === 'divider') {
      const symbol = b.id === 'classic_divider_services' ? '✂' : '◆';
      return `<div class="divider-ornate" ${mark}${inline}>
        <div class="divider-line"></div><span class="divider-diamond">${symbol}</span>
        <div class="divider-line"></div>
      </div>`;
    }
    if (b.kind === 'invoice-meta') {
      const row = (icon: string, label: string, value: string) =>
        `<div class="info-row"><span class="info-label"><span class="info-icon">${icon}</span>${label}</span><span class="info-value">${value}</span></div>`;
      return `<section ${mark}${inline}>
        <div class="receipt-title">${editable(b, 'receiptLabel', '✦ فاتورة مبيعات ✦')}</div>
        <div class="receipt-info">
          ${row('📄', editable(b, 'invoiceNumberLabel', 'رقم الفاتورة:'), '#' + escape(model.invoiceNo))}
          ${row('📅', editable(b, 'dateLabel', 'التاريخ:'), escape(model.date))}
          ${row('🕐', editable(b, 'timeLabel', 'الوقت:'), escape(model.time))}
          ${model.customer ? row('👤', editable(b, 'customerLabel', 'العميل:'), escape(model.customer)) : ''}
          ${model.customerPhone ? row('📞', editable(b, 'customerPhoneLabel', 'الهاتف:'), escape(model.customerPhone)) : ''}
          ${row('💳', editable(b, 'paymentLabel', 'طريقة الدفع:'), printPayment(model.payments))}
        </div>
      </section>`;
    }
    if (b.kind === 'payment') {
      // Classic puts the payment line inside the original metadata box.
      // An independently added payment block can render as its own row.
      const alreadyInMeta = blocks.some(x => x.kind === 'invoice-meta' && x.enabled);
      if (alreadyInMeta) return '';
      return `<div class="receipt-info" ${mark}${inline}>
        <div class="info-row"><span class="info-label">${editable(b,'paymentLabel','طريقة الدفع:')}</span>
        <span class="info-value">${printPayment(model.payments)}</span></div></div>`;
    }
    if (b.kind === 'items') {
      const rows = model.items.map((item, i) => `<tr>
        <td>${i + 1}</td>
        <td><div class="service-name">${escape(item.name)}</div>
          ${item.sublabel ? `<div class="barber-name">${escape(item.sublabel)}</div>` : ''}
          ${item.employee ? `<div class="barber-name">${escape(item.employee)}</div>` : ''}</td>
        <td>${item.price === null ? '' : `<div class="line-price-net">${money(item.price)} ج.م</div>`}</td>
      </tr>`).join('');
      return `<table ${mark}${inline}><thead><tr>
        <th>${editable(b,'numberHeader','#')}</th>
        <th>${editable(b,'serviceHeader','الخدمة / الحلاق')}</th>
        <th>${editable(b,'priceHeader','السعر')}</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
    }
    if (b.kind === 'totals') {
      const discountRows = model.discounts.filter(d => d.amount > 0).map(d =>
        `<div class="total-row discount"><span>${editable(b,'discountLabel','الخصومات:')} ${escape(d.label)}</span>
          <span>− ${money(d.amount)} ج.م</span></div>`
      ).join('');
      return `<div class="receipt-totals" ${mark}${inline}>
        <div class="total-row subtotal"><span>${editable(b,'subtotalLabel','المجموع الفرعي:')}</span>
          <span class="total-amount">${money(model.subtotal)} ج.م</span></div>
        ${discountRows}
        <div class="total-row grand">
          <span>${editable(b,'totalLabel','الإجمالي:')}</span>
          <span class="total-amount">${money(model.grandTotal)} ج.م</span>
        </div>
      </div>`;
    }
    if (b.kind === 'text') {
      if (b.id === 'classic_gift') return `<div class="gift-section" ${mark}${inline}>
        <div class="gift-icon">🎁</div><div class="gift-text" data-text-node>${escape(b.text)}</div>
      </div>`;
      return `<div class="studio-classic-text" ${mark}${inline}><span data-text-node>${escape(b.text)}</span></div>`;
    }
    if (b.kind === 'footer') {
      return `<div ${mark}${inline}>
        <div class="receipt-footer"><div class="thank-you-row">
          <span class="star-icon">★</span>
          <span class="thank-you">${editable(b,'thanksText',model.footer ?? 'شكراً لزيارتكم')}</span>
          <span class="star-icon">★</span>
        </div>
        <div class="footer-tagline">${editable(b,'footerTagline','نسعد بخدمتكم دائماً')}</div>
        ${model.phone ? `<div class="footer-contact">📞 ${escape(model.phone)}</div>` : ''}
        </div>
        <div class="footer-ornament"><div class="barber-pole-small"></div></div>
      </div>`;
    }
    if (b.kind === 'image') {
      const source = b.assetId && assets[b.assetId];
      if (!source || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(source)) return '';
      const width = b.style?.imageWidthMm ?? 36;
      return `<div class="classic-image" ${mark}${inline}>
        <img src="${source}" alt="" style="width:${width}mm;max-width:100%;height:auto" />
      </div>`;
    }
    return '';
  }).join('');

  return `<!DOCTYPE html><html dir="rtl" lang="ar" data-layout-variant="classic">
    <head><meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>CUT Classic — Receipt Studio</title>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <style>${CUT_CLASSIC_ORIGINAL_CSS}
        body{min-height:${template.paper.minHeightMm ?? 0}mm}
        .classic-edit-group{display:flex;flex-direction:column;min-width:0}
        .studio-classic-text{white-space:pre-wrap;text-align:center;margin:2mm 0}
        .classic-image{text-align:center;max-width:100%;margin:2mm auto}
        .classic-image img{filter:grayscale(1) contrast(2)}
      </style></head><body>
        <div class="receipt-frame">${render(template.blocks)}</div>
      </body></html>`;
}
