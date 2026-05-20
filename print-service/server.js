const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { print } = require('pdf-to-printer');
const { buildReceiptHTML } = require('./receipt-template');

const app = express();
const PORT = 7788;
const PRINTER_NAME = 'XP-80';

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pos-print-service',
    version: '1.0.0',
    printer: PRINTER_NAME,
    timestamp: new Date().toISOString()
  });
});

// Validate receipt data
function validateReceiptData(data) {
  const required = ['invID', 'invDate', 'invTime', 'GrandTotal'];
  const missing = required.filter(field => !data[field]);
  
  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  
  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
    return { valid: false, error: 'Items array is required and must not be empty' };
  }
  
  return { valid: true };
}

// Print receipt endpoint
app.post('/print/receipt', async (req, res) => {
  try {
    // Validate request body
    const validation = validateReceiptData(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    const receiptData = req.body;
    
    // Generate HTML — uses shared CUT SALON template (mirrors PrintInvoiceModal.tsx)
    const html = buildReceiptHTML(receiptData);
    
    // Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Set content and generate PDF
    // domcontentloaded avoids hanging on missing external resources (fonts etc.)
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    
    // Calculate dynamic height based on content
    const bodyHeightPx = await page.evaluate(() => {
      return Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
    });
    const heightMm = Math.ceil(bodyHeightPx * 0.264583) + 10;
    
    const pdfBuffer = await page.pdf({
      format: null,
      width: '80mm',
      height: `${heightMm}mm`,
      printBackground: true,
      margin: {
        top: '0mm',
        bottom: '0mm',
        left: '0mm',
        right: '0mm'
      }
    });
    
    await browser.close();
    
    // Save PDF temporarily and print
    const fs = require('fs');
    const path = require('path');
    const tempDir = path.join(__dirname, 'temp');
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    const pdfPath = path.join(tempDir, `receipt_${receiptData.invID}_${Date.now()}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);
    
    // Print to XP-80
    await print(pdfPath, {
      printer: PRINTER_NAME,
      silent: true
    });
    
    // Clean up temp file
    setTimeout(() => {
      try {
        fs.unlinkSync(pdfPath);
      } catch (err) {
        console.error('Error cleaning up temp file:', err);
      }
    }, 5000);
    
    res.json({
      success: true,
      message: 'Receipt printed successfully',
      invoiceId: receiptData.invID,
      printer: PRINTER_NAME
    });
    
  } catch (error) {
    console.error('Print error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🖨️  POS Print Service running on http://127.0.0.1:${PORT}`);
  console.log(`📋 Health: http://127.0.0.1:${PORT}/health`);
  console.log(`🖨️  Printer: ${PRINTER_NAME}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down print service...');
  process.exit(0);
});

module.exports = app;
