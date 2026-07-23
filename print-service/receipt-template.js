/**
 * CUT SALON Receipt HTML Template
 *
 * ⚠️  MIRRORS the POS browser receipt exactly.
 * Source of truth: src/components/pos/PrintInvoiceModal.tsx — THERMAL_CSS + buildReceiptHTML()
 * Keep both files in sync when the receipt design changes.
 *
 * Optimised for XP-80 / 80mm thermal printer via Puppeteer → PDF → pdf-to-printer.
 */

'use strict';

// ──────────────────────────────────────────────────────────────────────────────
// CSS — identical to THERMAL_CSS in PrintInvoiceModal.tsx
// ──────────────────────────────────────────────────────────────────────────────
const THERMAL_CSS = `
  @page {
    size: 72mm auto;
    margin: 0mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 72mm;
    max-width: 72mm;
    overflow: hidden;
    font-family: 'Cairo', 'Tahoma', sans-serif;
    direction: rtl;
    font-size: 10px;
    line-height: 1.3;
    color: #000;
    background: #fff;
    padding: 4mm 4mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Ornate Border Frame */
  .receipt-frame {
    border: 2px solid #000;
    border-radius: 8px;
    padding: 3mm;
    position: relative;
  }
  .receipt-frame::before {
    content: '';
    position: absolute;
    top: 1mm;
    left: 1mm;
    right: 1mm;
    bottom: 1mm;
    border: 1px solid #000;
    border-radius: 6px;
    pointer-events: none;
  }

  /* Header Section with Ornaments */
  .receipt-header {
    text-align: center;
    padding-bottom: 2mm;
    margin-bottom: 2mm;
    position: relative;
  }

  /* Barber Poles */
  .header-ornaments {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 3mm;
    margin-bottom: 2mm;
  }
  .barber-pole {
    width: 6mm;
    height: 12mm;
    border: 1.5px solid #000;
    border-radius: 3mm;
    background: repeating-linear-gradient(
      45deg,
      #fff,
      #fff 2px,
      #000 2px,
      #000 4px,
      #666 4px,
      #666 6px,
      #000 6px,
      #000 8px
    );
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Crown Logo */
  .logo-circle {
    width: 22mm;
    height: 22mm;
    margin: 0 auto;
    border: 3px solid #000;
    border-radius: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #fff;
    position: relative;
  }
  .crown      { font-size: 10px; margin-bottom: 1mm; }
  .logo-text  { font-size: 14px; font-weight: 900; letter-spacing: 1px; }
  .mustache   { font-size: 10px; margin-top: 1mm; }
  .scissors   { font-size: 8px;  margin-top: 0.5mm; }

  /* Salon Name */
  .salon-name-main {
    font-size: 20px;
    font-weight: 900;
    letter-spacing: 2px;
    margin-top: 2mm;
    margin-bottom: 1mm;
  }
  .salon-name-ar {
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 1mm;
  }
  .salon-phone {
    font-size: 11px;
    font-weight: 700;
    margin-bottom: 2mm;
  }

  /* Divider with Diamonds */
  .divider-ornate {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2mm;
    margin: 2mm 0;
    font-size: 8px;
  }
  .divider-line    { flex: 1; height: 1px; background: #000; }
  .divider-diamond { color: #000; font-size: 6px; }

  /* Receipt Title */
  .receipt-title {
    font-size: 12px;
    font-weight: 900;
    margin: 2mm 0;
    padding: 1mm 3mm;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    background: #fff;
  }

  /* Info Section with Icons */
  .receipt-info {
    margin-bottom: 2mm;
    font-size: 10px;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5mm;
    padding: 1mm 0;
    border-bottom: 1px dotted #000;
  }
  .info-row:last-child { border-bottom: none; }
  .info-label {
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 1mm;
  }
  .info-icon  { font-size: 10px; }
  .info-value { font-weight: 600; font-family: 'Courier New', monospace; }

  /* Services Table */
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: 2mm 0;
    border: 2px solid #000;
  }
  thead {
    background: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  th {
    padding: 2mm 1.5mm;
    font-size: 9px;
    font-weight: 900;
    text-align: right;
    border: 1px solid #000;
    color: #fff;
  }
  th:first-child { text-align: center; width: 8mm; }
  th:last-child  { text-align: left;  width: 18mm; }
  td {
    padding: 2mm 1.5mm;
    font-size: 9px;
    border: 1px solid #000;
    vertical-align: top;
  }
  td:first-child { text-align: center; font-weight: 700; }
  td:last-child  { text-align: left; font-weight: 700; font-family: 'Courier New', monospace; }
  tbody tr:nth-child(even) { background: #fff; }
  .service-name { font-weight: 700; margin-bottom: 0.5mm; font-size: 10px; }
  .barber-name  { font-size: 8px; font-weight: 600; color: #000; }
  .line-price-block { text-align: left; }
  .line-price-gross { font-size: 8px; text-decoration: line-through; opacity: 0.75; }
  .line-price-disc { font-size: 8px; font-weight: 700; }
  .line-price-net { font-size: 10px; font-weight: 900; }

  /* Totals Section */
  .receipt-totals {
    margin: 2mm 0;
    padding: 2mm;
    border: 2px solid #000;
    border-radius: 4px;
  }
  .total-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1mm;
    font-size: 10px;
  }
  .total-row.subtotal { font-weight: 600; }
  .total-row.discount { font-weight: 700; color: #000; }
  .total-row.grand {
    font-size: 16px;
    font-weight: 900;
    margin-top: 2mm;
    padding-top: 2mm;
    border-top: 2px double #000;
  }
  .total-amount { font-family: 'Courier New', monospace; font-weight: 900; }

  /* Gift Promotion Section */
  .gift-section {
    margin: 3mm 0;
    padding: 3mm 2mm;
    border: 2px solid #000;
    border-radius: 6px;
    background: #fff;
    text-align: center;
    position: relative;
  }
  .gift-section::before,
  .gift-section::after {
    content: '✦';
    position: absolute;
    top: 1mm;
    font-size: 8px;
    color: #000;
  }
  .gift-section::before { left: 2mm; }
  .gift-section::after  { right: 2mm; }
  .gift-icon { font-size: 16px; margin-bottom: 1mm; }
  .gift-text { font-size: 14px; font-weight: 900; letter-spacing: 1px; }

  /* Footer */
  .receipt-footer {
    text-align: center;
    margin-top: 3mm;
    padding-top: 2mm;
    font-size: 10px;
  }
  .thank-you-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2mm;
    margin-bottom: 1mm;
  }
  .thank-you      { font-size: 11px; font-weight: 700; }
  .star-icon      { font-size: 8px; }
  .footer-tagline { font-size: 9px; font-weight: 600; margin-bottom: 1mm; }
  .footer-contact {
    font-size: 9px;
    font-weight: 700;
    margin-top: 1mm;
    padding-top: 1mm;
    border-top: 1px solid #000;
  }

  /* Bottom Barber Pole */
  .footer-ornament {
    display: flex;
    justify-content: center;
    margin-top: 2mm;
  }
  .barber-pole-small {
    width: 5mm;
    height: 10mm;
    border: 1.5px solid #000;
    border-radius: 2.5mm;
    background: repeating-linear-gradient(
      45deg,
      #fff,
      #fff 1.5px,
      #000 1.5px,
      #000 3px,
      #666 3px,
      #666 4.5px,
      #000 4.5px,
      #000 6px
    );
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
`;

// ──────────────────────────────────────────────────────────────────────────────
// HTML builder — mirrors buildReceiptHTML() in PrintInvoiceModal.tsx
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build the full receipt HTML string from invoice data.
 *
 * Accepted fields (defensive — all optional except invID, GrandTotal):
 *   invID, invDate, invTime,
 *   customerName, customerPhone,
 *   SubTotal, Dis, DisVal, GrandTotal,
 *   PayCash, PayVisa, PaymentMethodID,
 *   items[].ProName, items[].EmpName, items[].SPrice, items[].Qty,
 *   items[].SPriceAfterDis, items[].DisVal, items[].SValue
 */
function buildReceiptHTML(data) {
  const fmtDate = (d) => {
    try {
      return new Date(d).toLocaleDateString('ar-EG', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return d || '';
    }
  };

  // Resolve payment method label — same logic as PrintInvoiceModal
  const payCash = Number(data.PayCash) || 0;
  const payVisa = Number(data.PayVisa) || 0;
  const paymentMethod =
    payCash > 0 && payVisa > 0 ? 'نقدي + فيزا'
    : payVisa > 0              ? 'فيزا'
    :                            'نقدي';

  const items = Array.isArray(data.items) ? data.items : [];

  const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

  const itemRows = items.map((item, i) => {
    const qty = Number(item.Qty) > 0 ? Number(item.Qty) : 1;
    const gross =
      item.SValue != null && Number(item.SValue) > 0
        ? Number(item.SValue)
        : Number(item.SPrice || 0) * qty;
    const disVal = Math.max(0, Number(item.DisVal || 0));
    const net =
      item.SPriceAfterDis != null && Number.isFinite(Number(item.SPriceAfterDis))
        ? Number(item.SPriceAfterDis)
        : Math.max(0, gross - disVal);

    const serviceName = `<div class="service-name">${item.ProName || ''}</div>`;
    const barberName  = item.EmpName ? `<div class="barber-name">${item.EmpName}</div>` : '';
    const priceCell =
      disVal > 0
        ? `<div class="line-price-block">
            <div class="line-price-gross">${money(gross)} ج.م</div>
            <div class="line-price-disc">خصم: -${money(disVal)}</div>
            <div class="line-price-net">${money(net)} ج.م</div>
          </div>`
        : `<div class="line-price-net">${money(net > 0 ? net : gross)} ج.م</div>`;

    return `<tr>
        <td>${i + 1}</td>
        <td>${serviceName}${barberName}</td>
        <td>${priceCell}</td>
      </tr>`;
  }).join('');

  const lineDiscountTotal = items.reduce(
    (sum, item) => sum + Math.max(0, Number(item.DisVal || 0)),
    0,
  );
  const headerDiscount = Math.max(0, Number(data.DisVal) || 0);
  const shownDiscount = headerDiscount > 0 ? headerDiscount : lineDiscountTotal;
  const discountLabel = headerDiscount > 0 ? 'الخصم:' : 'إجمالي خصومات الخدمات:';
  const discountRow = shownDiscount > 0
    ? `<div class="total-row discount"><span>${discountLabel}</span><span>- ${money(shownDiscount)} ج.م</span></div>`
    : '';

  const subTotal   = Number(data.SubTotal)   || 0;
  const grandTotal = Number(data.GrandTotal) || 0;

  const customerNameRow = data.customerName
    ? `<div class="info-row">
        <span class="info-label"><span class="info-icon">👤</span> العميل:</span>
        <span class="info-value">${data.customerName}</span>
      </div>`
    : '';

  const customerPhoneRow = data.customerPhone
    ? `<div class="info-row">
        <span class="info-label"><span class="info-icon">📞</span> الهاتف:</span>
        <span class="info-value">${data.customerPhone}</span>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>فاتورة #${data.invID}</title>
  <style>${THERMAL_CSS}</style>
</head>
<body>
  <div class="receipt-frame">

    <!-- Header with Ornaments -->
    <div class="receipt-header">
      <div class="header-ornaments">
        <div class="barber-pole"></div>
        <div class="logo-circle">
          <div class="crown">&#x1F451;</div>
          <div class="logo-text">CUT</div>
          <div class="mustache">&#x3030;</div>
          <div class="scissors">&#x2702;</div>
        </div>
        <div class="barber-pole"></div>
      </div>
      <div class="salon-name-main">CUT SALON</div>
      <div class="salon-name-ar">&#x635;&#x627;&#x644;&#x648;&#x646; &#x643;&#x62A; &#x644;&#x644;&#x631;&#x62C;&#x627;&#x644;</div>
      <div class="salon-phone">&#x1F4DE; 01012126899</div>
    </div>

    <!-- Divider -->
    <div class="divider-ornate">
      <div class="divider-line"></div>
      <span class="divider-diamond">&#x25C6;</span>
      <div class="divider-line"></div>
    </div>

    <!-- Receipt Title -->
    <div class="receipt-title">&#x2726; &#x641;&#x627;&#x62A;&#x648;&#x631;&#x629; &#x645;&#x628;&#x64A;&#x639;&#x627;&#x62A; &#x2726;</div>

    <!-- Invoice Info -->
    <div class="receipt-info">
      <div class="info-row">
        <span class="info-label"><span class="info-icon">&#x1F4C4;</span> &#x631;&#x642;&#x645; &#x627;&#x644;&#x641;&#x627;&#x62A;&#x648;&#x631;&#x629;:</span>
        <span class="info-value">#${data.invID}</span>
      </div>
      <div class="info-row">
        <span class="info-label"><span class="info-icon">&#x1F4C5;</span> &#x627;&#x644;&#x62A;&#x627;&#x631;&#x64A;&#x62E;:</span>
        <span class="info-value">${fmtDate(data.invDate)}</span>
      </div>
      <div class="info-row">
        <span class="info-label"><span class="info-icon">&#x1F550;</span> &#x627;&#x644;&#x648;&#x642;&#x62A;:</span>
        <span class="info-value">${data.invTime || ''}</span>
      </div>
      ${customerNameRow}
      ${customerPhoneRow}
      <div class="info-row">
        <span class="info-label"><span class="info-icon">&#x1F4B3;</span> &#x637;&#x631;&#x64A;&#x642;&#x629; &#x627;&#x644;&#x62F;&#x641;&#x639;:</span>
        <span class="info-value">${paymentMethod}</span>
      </div>
    </div>

    <!-- Divider -->
    <div class="divider-ornate">
      <div class="divider-line"></div>
      <span class="divider-diamond">&#x2702;</span>
      <div class="divider-line"></div>
    </div>

    <!-- Services Table -->
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>&#x627;&#x644;&#x62E;&#x62F;&#x645;&#x629; / &#x627;&#x644;&#x62D;&#x644;&#x627;&#x642;</th>
          <th>&#x627;&#x644;&#x633;&#x639;&#x631;</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <!-- Totals -->
    <div class="receipt-totals">
      <div class="total-row subtotal">
        <span>&#x627;&#x644;&#x645;&#x62C;&#x645;&#x648;&#x639; &#x627;&#x644;&#x641;&#x631;&#x639;&#x64A;:</span>
        <span class="total-amount">${subTotal} &#x62C;.&#x645;</span>
      </div>
      ${discountRow}
      <div class="total-row grand">
        <span>&#x627;&#x644;&#x625;&#x62C;&#x645;&#x627;&#x644;&#x64A;:</span>
        <span class="total-amount">${grandTotal} &#x62C;.&#x645;</span>
      </div>
    </div>

    <!-- Gift Promotion -->
    <div class="gift-section">
      <div class="gift-icon">&#x1F381;</div>
      <div class="gift-text">&#x627;&#x633;&#x623;&#x644; &#x639;&#x644;&#x649; &#x647;&#x62F;&#x64A;&#x62A;&#x643;</div>
    </div>

    <!-- Footer -->
    <div class="receipt-footer">
      <div class="thank-you-row">
        <span class="star-icon">&#x2605;</span>
        <span class="thank-you">&#x634;&#x643;&#x631;&#x627;&#x64B; &#x644;&#x632;&#x64A;&#x627;&#x631;&#x62A;&#x643;&#x645;</span>
        <span class="star-icon">&#x2605;</span>
      </div>
      <div class="footer-tagline">&#x646;&#x633;&#x639;&#x62F; &#x628;&#x62E;&#x62F;&#x645;&#x62A;&#x643;&#x645; &#x62F;&#x627;&#x626;&#x645;&#x627;&#x64B;</div>
      <div class="footer-contact">&#x1F4DE; 01012126899 - 035861483</div>
    </div>

    <!-- Bottom Ornament -->
    <div class="footer-ornament">
      <div class="barber-pole-small"></div>
    </div>

  </div>
</body>
</html>`;
}

module.exports = { buildReceiptHTML };
