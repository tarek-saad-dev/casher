'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { buildReceiptHTML } = require('./receipt-template');
const { printPdf, getAdapterMode } = require('./printerAdapter');

const app = express();
const PORT = Number(process.env.PRINTER_SERVICE_PORT || 7788);
const PRINTER_NAME = process.env.PRINTER_NAME || 'XP-80';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'http://localhost:5500,http://127.0.0.1:5500'
).split(',').map((s) => s.trim()).filter(Boolean);

app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin(origin, callback) {
    // Allow non-browser clients (curl/PowerShell) that send no Origin
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Request-Id'],
}));

function createRequestId(incoming) {
  if (typeof incoming === 'string' && incoming.trim()) return incoming.trim().slice(0, 64);
  return `ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function logErrorDetails(requestId, error, extra = {}) {
  console.error(`[print-service][${requestId}] error details`, {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    stage: error?.stage,
    exitCode: error?.exitCode ?? error?.status,
    stdout: error?.stdout,
    stderr: error?.stderr,
    printer: error?.printer || PRINTER_NAME,
    stack: error?.stack,
    ...extra,
  });
}

function errorResponse(res, status, {
  requestId,
  stage,
  code,
  message,
  printer = PRINTER_NAME,
}) {
  return res.status(status).json({
    ok: false,
    success: false,
    stage,
    code,
    message,
    requestId,
    printer,
  });
}

function validateReceiptData(data) {
  const required = ['invID', 'invDate', 'invTime', 'GrandTotal'];
  const missing = required.filter((field) => data[field] === undefined || data[field] === null || data[field] === '');

  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}`, code: 'INVALID_PAYLOAD' };
  }

  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
    return { valid: false, error: 'Items array is required and must not be empty', code: 'INVALID_PAYLOAD' };
  }

  return { valid: true };
}

/**
 * Render HTML → PDF → Windows spooler via adapter.
 */
async function printHtmlDocument(html, {
  requestId,
  width = '80mm',
  printer = PRINTER_NAME,
  filePrefix = 'doc',
}) {
  if (!html || typeof html !== 'string' || html.trim().length < 10) {
    const err = new Error('html is required and must be a non-empty string');
    err.code = 'INVALID_PAYLOAD';
    err.stage = 'validation';
    throw err;
  }

  console.log(`[print-service][${requestId}] payload validated`, {
    htmlLength: html.length,
    width,
    printer,
  });
  console.log(`[print-service][${requestId}] printer resolved`, { printer });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const bodyHeightPx = await page.evaluate(() => Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    ));
    const heightMm = Math.ceil(bodyHeightPx * 0.264583) + 10;

    const pdfBuffer = await page.pdf({
      format: null,
      width,
      height: `${heightMm}mm`,
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    });

    await browser.close();
    browser = null;

    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const pdfPath = path.join(tempDir, `${filePrefix}_${Date.now()}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);

    try {
      await printPdf(pdfPath, { printer, requestId });
    } finally {
      setTimeout(() => {
        try { fs.unlinkSync(pdfPath); } catch (cleanupErr) {
          console.error(`[print-service][${requestId}] temp cleanup failed`, cleanupErr.message);
        }
      }, 5000);
    }

    return { printer, width };
  } catch (error) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    if (!error.stage) {
      error.stage = error.code === 'INVALID_PAYLOAD' ? 'validation'
        : (String(error.message || '').toLowerCase().includes('printer') ? 'printer_resolution' : 'command');
    }
    if (!error.code) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('not found') || msg.includes('cannot find')) error.code = 'PRINTER_NOT_FOUND';
      else if (msg.includes('offline')) error.code = 'PRINTER_OFFLINE';
      else if (msg.includes('spool')) error.code = 'SPOOLER_ERROR';
      else error.code = 'PRINT_COMMAND_FAILED';
    }
    throw error;
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ok: true,
    service: 'pos-print-service',
    version: '1.1.0',
    printer: PRINTER_NAME,
    adapter: getAdapterMode(),
    timestamp: new Date().toISOString(),
  });
});

// Sales receipt (structured JSON → shared template)
app.post('/print/receipt', async (req, res) => {
  const requestId = createRequestId(req.body?.requestId || req.get('X-Request-Id'));
  console.log(`[print-service][${requestId}] request received`, { endpoint: '/print/receipt' });

  try {
    const validation = validateReceiptData(req.body || {});
    if (!validation.valid) {
      return errorResponse(res, 400, {
        requestId,
        stage: 'validation',
        code: validation.code || 'INVALID_PAYLOAD',
        message: validation.error,
      });
    }

    const receiptData = req.body;
    const html = buildReceiptHTML(receiptData);
    const result = await printHtmlDocument(html, {
      requestId,
      width: '80mm',
      printer: PRINTER_NAME,
      filePrefix: `receipt_${receiptData.invID}`,
    });

    return res.json({
      ok: true,
      success: true,
      message: 'Receipt printed successfully',
      invoiceId: receiptData.invID,
      printer: result.printer,
      requestId,
    });
  } catch (error) {
    logErrorDetails(requestId, error, { endpoint: '/print/receipt' });
    return errorResponse(res, 500, {
      requestId,
      stage: error.stage || 'command',
      code: error.code || 'PRINT_COMMAND_FAILED',
      message: error.message || 'Print failed',
      printer: error.printer || PRINTER_NAME,
    });
  }
});

// Generic HTML print (expenses, booking tickets, custom receipts)
app.post('/print/html', async (req, res) => {
  const requestId = createRequestId(req.body?.requestId || req.get('X-Request-Id'));
  console.log(`[print-service][${requestId}] request received`, {
    endpoint: '/print/html',
    htmlLength: typeof req.body?.html === 'string' ? req.body.html.length : 0,
  });

  try {
    const html = req.body?.html;
    const width = typeof req.body?.width === 'string' && req.body.width ? req.body.width : '80mm';
    const printer = (typeof req.body?.printer === 'string' && req.body.printer && req.body.printer !== 'default')
      ? req.body.printer
      : PRINTER_NAME;

    const result = await printHtmlDocument(html, {
      requestId,
      width,
      printer,
      filePrefix: 'html',
    });

    return res.json({
      ok: true,
      success: true,
      message: 'HTML printed successfully',
      printer: result.printer,
      requestId,
    });
  } catch (error) {
    logErrorDetails(requestId, error, { endpoint: '/print/html' });
    const status = error.code === 'INVALID_PAYLOAD' ? 400 : 500;
    return errorResponse(res, status, {
      requestId,
      stage: error.stage || 'command',
      code: error.code || 'PRINT_COMMAND_FAILED',
      message: error.message || 'Print failed',
      printer: error.printer || PRINTER_NAME,
    });
  }
});

// Safe diagnostic test print (short line only — explicit opt-in)
app.post('/print/test', async (req, res) => {
  const requestId = createRequestId(req.body?.requestId || req.get('X-Request-Id'));
  console.log(`[print-service][${requestId}] request received`, { endpoint: '/print/test' });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body{font-family:sans-serif;font-size:14px;padding:8px;width:72mm}
  </style></head><body>
    <strong>CUT SALON TEST PRINT</strong><br/>
    ${new Date().toISOString()}<br/>
    requestId: ${requestId}
  </body></html>`;

  try {
    const result = await printHtmlDocument(html, {
      requestId,
      width: '80mm',
      printer: PRINTER_NAME,
      filePrefix: 'test',
    });
    return res.json({
      ok: true,
      success: true,
      message: 'Test print completed',
      printer: result.printer,
      requestId,
      mode: req.body?.mode || 'diagnostic',
    });
  } catch (error) {
    logErrorDetails(requestId, error, { endpoint: '/print/test' });
    return errorResponse(res, 500, {
      requestId,
      stage: error.stage || 'command',
      code: error.code || 'PRINT_COMMAND_FAILED',
      message: error.message || 'Test print failed',
    });
  }
});

function startServer(listenPort = PORT) {
  return app.listen(listenPort, '127.0.0.1', () => {
    console.log(`🖨️  POS Print Service running on http://127.0.0.1:${listenPort}`);
    console.log(`📋 Health: http://127.0.0.1:${listenPort}/health`);
    console.log(`🖨️  Printer: ${PRINTER_NAME} (adapter=${getAdapterMode()})`);
  });
}

if (require.main === module) {
  startServer();
}

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down print service...');
  process.exit(0);
});

module.exports = {
  app,
  startServer,
  validateReceiptData,
  printHtmlDocument,
  createRequestId,
  PRINTER_NAME,
};
