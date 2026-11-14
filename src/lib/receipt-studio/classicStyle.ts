/**
 * FROZEN REFERENCE: the exact thermal CSS from the originally printed CUT
 * receipt in PrintInvoiceModal (snapshot of pre-CUT-Classic preset).
 *
 * Do not modify this constant to customize an invoice. Receipt Studio creates
 * an editable validated JSON template instead. Any style changes to the live
 * legacy receipt require separate, explicit review.
 */
export const CUT_CLASSIC_ORIGINAL_CSS = `
  @page {
    size: 80mm 200mm;
    margin: 0mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 72mm;
    max-width: 72mm;
    overflow: hidden;
    font-family: 'Cairo', sans-serif;
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
  .crown {
    font-size: 10px;
    margin-bottom: 1mm;
  }
  .logo-text {
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 1px;
  }
  .mustache {
    font-size: 10px;
    margin-top: 1mm;
  }
  .scissors {
    font-size: 8px;
    margin-top: 0.5mm;
  }
  
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
  .divider-line {
    flex: 1;
    height: 1px;
    background: #000;
  }
  .divider-diamond {
    color: #000;
    font-size: 6px;
  }
  
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
  .info-icon {
    font-size: 10px;
  }
  .info-value {
    font-weight: 600;
    font-family: 'Courier New', monospace;
  }
  
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
  th:last-child { text-align: left; width: 18mm; }
  td {
    padding: 2mm 1.5mm;
    font-size: 9px;
    border: 1px solid #000;
    vertical-align: top;
  }
  td:first-child { text-align: center; font-weight: 700; }
  td:last-child { text-align: left; font-weight: 700; font-family: 'Courier New', monospace; }
  tbody tr:nth-child(even) { background: #fff; }
  .service-name { font-weight: 700; margin-bottom: 0.5mm; font-size: 10px; }
  .barber-name { font-size: 8px; font-weight: 600; color: #000; }
  .line-price-block { text-align: left; }
  .line-price-gross { font-size: 8px; text-decoration: line-through; opacity: 0.75; }
  .line-price-disc { font-size: 8px; font-weight: 700; }
  .line-price-net { font-size: 10px; font-weight: 900; }
  tr.pkg-item td { padding: 1mm 1.5mm; border-top-style: dotted; }
  .pkg-item-name { font-size: 9px; font-weight: 600; padding-inline-start: 2mm; }
  .pkg-item-price { font-size: 9px; font-weight: 600; }
  
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
  .total-amount {
    font-family: 'Courier New', monospace;
    font-weight: 900;
  }
  
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
  .gift-section::after { right: 2mm; }
  .gift-icon {
    font-size: 16px;
    margin-bottom: 1mm;
  }
  .gift-text {
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 1px;
  }
  
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
  .thank-you {
    font-size: 11px;
    font-weight: 700;
  }
  .star-icon {
    font-size: 8px;
  }
  .footer-tagline {
    font-size: 9px;
    font-weight: 600;
    margin-bottom: 1mm;
  }
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
  }
  /* Printer readability: actual ESC/POS bitmap renders screen CSS, not @media print. */
  html, body { font-size: 12px; line-height: 1.4; }
  .receipt-info, .total-row { font-size: 12px; }
  th, td { font-size: 11px; padding: 2mm 1mm; }
  .service-name { font-size: 12px; }
  .barber-name, .line-price-gross, .line-price-disc,
  .pkg-item-name, .pkg-item-price { font-size: 10px; }
  .line-price-net { font-size: 12px; }
  .total-row.grand { font-size: 18px; }

`;
